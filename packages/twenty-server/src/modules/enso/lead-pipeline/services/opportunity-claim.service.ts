import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';
import { IsNull } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { isCompanyAutomationEnabled } from 'src/modules/enso/company-enrichment/company-enrichment.constants';
import { SYSTEM_ACTOR } from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';
import { PersonProjectAssignmentNameService } from 'src/modules/enso/person-project-assignment/services/person-project-assignment-name.service';
import {
  buildEnsoTimelineInserts,
  type EnsoTimelineSegment,
} from 'src/modules/enso/timeline/enso-timeline.util';

// Inbound-activity object metadata id (single prod workspace) — used as the
// linkedObjectMetadataId on enso-event rows so they share the green ENSO icon
// (the icon is decorative; record navigation is via the sentence links).
const INBOUND_ACTIVITY_OBJECT_METADATA_ID =
  'cef40992-41c4-4742-8b4c-234777a1b8c6';

// When an opportunity is claimed (leaves ROUTING with an owner), make that
// manager the sticky owner of the (person × project) so future inquiries route
// straight to them. Stickiness is written on CLAIM, not on tentative
// assignment — a rerouted/never-claimed manager never becomes sticky.
// Idempotent: a no-op if the active assignment already names this manager.
@Injectable()
export class OpportunityClaimService {
  private readonly logger = new Logger(OpportunityClaimService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly personProjectAssignmentNameService: PersonProjectAssignmentNameService,
  ) {}

  async syncStickyAssignment(
    authContext: WorkspaceAuthContext,
    opportunityId: string,
  ): Promise<void> {
    const workspaceId = authContext.workspace?.id;

    if (!workspaceId || !isDefined(opportunityId)) {
      return;
    }

    const systemAuthContext = buildSystemAuthContext(workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const opportunityRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'opportunity',
          { shouldBypassPermissionChecks: true },
        );

      const opportunity = await opportunityRepository.findOne({
        where: { id: opportunityId },
      });

      // Only act on claimed deals (left ROUTING with an owner + a project).
      if (
        !opportunity ||
        opportunity.stage === 'ROUTING' ||
        !isDefined(opportunity.ownerId) ||
        !isDefined(opportunity.projectId)
      ) {
        return;
      }

      // Person-level stickiness (returning human → same manager).
      if (isDefined(opportunity.pointOfContactId)) {
        await this.upsertPersonAssignment(
          workspaceId,
          authContext,
          opportunity,
        );
      }

      // Company-level stickiness (B2B account → same manager for any contact),
      // gated by the master flag.
      if (isCompanyAutomationEnabled() && isDefined(opportunity.companyId)) {
        await this.upsertCompanyAssignment(workspaceId, opportunity);
      }
    }, systemAuthContext);
  }

  // Sticky (person × project) → manager, written on claim. Idempotent.
  private async upsertPersonAssignment(
    workspaceId: string,
    authContext: WorkspaceAuthContext,
    opportunity: {
      id: string;
      ownerId: string;
      projectId: string;
      pointOfContactId: string;
      companyId?: string | null;
    },
  ): Promise<void> {
    const assignmentRepository =
      await this.globalWorkspaceOrmManager.getRepository<any>(
        workspaceId,
        'personProjectAssignment',
        { shouldBypassPermissionChecks: true },
      );

    const existing = await assignmentRepository.findOne({
      where: {
        personId: opportunity.pointOfContactId,
        projectId: opportunity.projectId,
        endedAt: IsNull(),
      },
      order: { assignedAt: 'DESC' },
    });

    if (existing?.managerId === opportunity.ownerId) {
      return;
    }

    const name = await this.personProjectAssignmentNameService.computeName(
      authContext,
      { projectId: opportunity.projectId, managerId: opportunity.ownerId },
    );

    if (existing) {
      await assignmentRepository.update(
        { id: existing.id },
        {
          managerId: opportunity.ownerId,
          assignedAt: new Date(),
          ...(isDefined(name) ? { name } : {}),
        },
      );
    } else {
      const lastPosition = await assignmentRepository.maximum(
        'position',
        undefined,
      );

      await assignmentRepository.insert({
        personId: opportunity.pointOfContactId,
        projectId: opportunity.projectId,
        managerId: opportunity.ownerId,
        assignedAt: new Date(),
        position: (lastPosition ?? 0) + 1,
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
        ...(isDefined(name) ? { name } : {}),
      });

      this.logger.log(
        `Sticky assignment set: person ${opportunity.pointOfContactId} × project ${opportunity.projectId} → ${opportunity.ownerId}.`,
      );
    }

    // B2C deals (no company) surface a deal-claimed event on the deal + person.
    // B2B deals get the company-level account-assigned event instead.
    if (!isDefined(opportunity.companyId)) {
      await this.recordDealClaimedEvent(workspaceId, {
        id: opportunity.id,
        ownerId: opportunity.ownerId,
        projectId: opportunity.projectId,
        pointOfContactId: opportunity.pointOfContactId,
      });
    }
  }

  // Sticky (company × project) → manager (B2B account ownership), written on
  // claim. Idempotent; on a new/changed owner, emits an account-assigned event.
  private async upsertCompanyAssignment(
    workspaceId: string,
    opportunity: {
      id: string;
      ownerId: string;
      projectId: string;
      companyId: string;
    },
  ): Promise<void> {
    const assignmentRepository =
      await this.globalWorkspaceOrmManager.getRepository<any>(
        workspaceId,
        'companyProjectAssignment',
        { shouldBypassPermissionChecks: true },
      );

    const existing = await assignmentRepository.findOne({
      where: {
        companyId: opportunity.companyId,
        projectId: opportunity.projectId,
        endedAt: IsNull(),
      },
      order: { assignedAt: 'DESC' },
    });

    if (existing?.managerId === opportunity.ownerId) {
      return;
    }

    const name = await this.computeCompanyAssignmentName(
      workspaceId,
      opportunity.companyId,
      opportunity.projectId,
    );

    if (existing) {
      await assignmentRepository.update(
        { id: existing.id },
        {
          managerId: opportunity.ownerId,
          assignedAt: new Date(),
          ...(isDefined(name) ? { name } : {}),
        },
      );
    } else {
      const lastPosition = await assignmentRepository.maximum(
        'position',
        undefined,
      );

      await assignmentRepository.insert({
        companyId: opportunity.companyId,
        projectId: opportunity.projectId,
        managerId: opportunity.ownerId,
        assignedAt: new Date(),
        position: (lastPosition ?? 0) + 1,
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
        ...(isDefined(name) ? { name } : {}),
      });
    }

    this.logger.log(
      `Account assignment set: company ${opportunity.companyId} × project ${opportunity.projectId} → ${opportunity.ownerId}.`,
    );

    await this.recordAccountAssignedEvent(workspaceId, opportunity);
  }

  // "{Company} · {Project}" label for the assignment record (best-effort).
  private async computeCompanyAssignmentName(
    workspaceId: string,
    companyId: string,
    projectId: string,
  ): Promise<string | undefined> {
    try {
      const companyRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'company',
          { shouldBypassPermissionChecks: true },
        );
      const projectRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'project',
          { shouldBypassPermissionChecks: true },
        );
      const company = await companyRepository.findOne({
        where: { id: companyId },
      });
      const project = await projectRepository.findOne({
        where: { id: projectId },
      });
      const parts = [company?.name, project?.name].filter(
        (part): part is string => isDefined(part) && part !== '',
      );

      return parts.length > 0 ? parts.join(' · ') : undefined;
    } catch {
      return undefined;
    }
  }

  // account-assigned (B2B) timeline event on the deal + company: the manager
  // became the account owner for the company on this project.
  private async recordAccountAssignedEvent(
    workspaceId: string,
    opportunity: {
      id: string;
      ownerId: string;
      projectId: string;
      companyId: string;
    },
  ): Promise<void> {
    try {
      const managerName = await this.lookupMemberName(
        workspaceId,
        opportunity.ownerId,
      );
      const dealName = await this.lookupName(
        workspaceId,
        'opportunity',
        opportunity.id,
      );
      const companyName = await this.lookupName(
        workspaceId,
        'company',
        opportunity.companyId,
      );

      const segments: EnsoTimelineSegment[] = [
        { text: 'Assigned ' },
        {
          label: dealName || 'this deal',
          objectNameSingular: 'opportunity',
          recordId: opportunity.id,
        },
        { text: ' to ' },
        {
          label: managerName,
          objectNameSingular: 'workspaceMember',
          recordId: opportunity.ownerId,
        },
        { text: ' as account owner — future leads from ' },
        {
          label: companyName || 'this company',
          objectNameSingular: 'company',
          recordId: opportunity.companyId,
        },
        { text: ' on this project route to them.' },
      ];

      const timelineRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'timelineActivity',
          { shouldBypassPermissionChecks: true },
        );

      const rows = buildEnsoTimelineInserts({
        action: 'account-assigned',
        target: {
          opportunityId: opportunity.id,
          companyId: opportunity.companyId,
        },
        segments,
        auto: true,
        linkedObjectMetadataId: INBOUND_ACTIVITY_OBJECT_METADATA_ID,
      });

      if (rows.length > 0) {
        await timelineRepository.insert(rows);
      }
    } catch (error) {
      this.logger.warn(
        `account-assigned timeline write failed for company ${opportunity.companyId}: ${
          (error as Error).message
        }`,
      );
    }
  }

  // deal-claimed (B2C) timeline event on the deal + person: the manager owns
  // this lead on the project going forward. B2B deals use account-assigned
  // instead (company-level ownership).
  private async recordDealClaimedEvent(
    workspaceId: string,
    opportunity: {
      id: string;
      ownerId: string;
      projectId: string;
      pointOfContactId: string;
    },
  ): Promise<void> {
    try {
      const managerName = await this.lookupMemberName(
        workspaceId,
        opportunity.ownerId,
      );
      const personName = await this.lookupName(
        workspaceId,
        'person',
        opportunity.pointOfContactId,
      );
      const projectName = await this.lookupName(
        workspaceId,
        'project',
        opportunity.projectId,
      );

      const segments: EnsoTimelineSegment[] = [
        { text: 'Routed during intake and assigned to ' },
        {
          label: managerName,
          objectNameSingular: 'workspaceMember',
          recordId: opportunity.ownerId,
        },
        { text: ' — from now on responsible for ' },
        {
          label: personName || 'this contact',
          objectNameSingular: 'person',
          recordId: opportunity.pointOfContactId,
        },
      ];

      if (projectName) {
        segments.push(
          { text: ' on ' },
          {
            label: projectName,
            objectNameSingular: 'project',
            recordId: opportunity.projectId,
          },
        );
      }
      segments.push({ text: '.' });

      const timelineRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'timelineActivity',
          { shouldBypassPermissionChecks: true },
        );

      const rows = buildEnsoTimelineInserts({
        action: 'deal-claimed',
        target: {
          opportunityId: opportunity.id,
          personId: opportunity.pointOfContactId,
        },
        segments,
        auto: true,
        linkedObjectMetadataId: INBOUND_ACTIVITY_OBJECT_METADATA_ID,
      });

      if (rows.length > 0) {
        await timelineRepository.insert(rows);
      }
    } catch (error) {
      this.logger.warn(
        `deal-claimed timeline write failed for opportunity ${opportunity.id}: ${
          (error as Error).message
        }`,
      );
    }
  }

  // "First Last" for a workspace member, or "A manager" fallback.
  private async lookupMemberName(
    workspaceId: string,
    workspaceMemberId: string,
  ): Promise<string> {
    try {
      const repository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'workspaceMember',
          { shouldBypassPermissionChecks: true },
        );
      const member = await repository.findOne({
        where: { id: workspaceMemberId },
      });

      const name = member?.name
        ? `${member.name.firstName ?? ''} ${member.name.lastName ?? ''}`.trim()
        : '';

      return name.length > 0 ? name : 'A manager';
    } catch {
      return 'A manager';
    }
  }

  // Best-effort display name for a record (person → full name, else .name).
  private async lookupName(
    workspaceId: string,
    objectNameSingular: string,
    recordId: string,
  ): Promise<string> {
    try {
      const repository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          objectNameSingular,
          { shouldBypassPermissionChecks: true },
        );
      const record = await repository.findOne({ where: { id: recordId } });

      if (!record) {
        return '';
      }

      if (objectNameSingular === 'person') {
        return [record.name?.firstName, record.name?.lastName]
          .filter((part) => typeof part === 'string' && part.length > 0)
          .join(' ')
          .trim();
      }

      return typeof record.name === 'string' ? record.name : '';
    } catch {
      return '';
    }
  }
}
