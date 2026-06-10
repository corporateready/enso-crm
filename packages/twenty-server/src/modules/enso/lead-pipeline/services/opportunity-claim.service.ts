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

// Workspace member object metadata id (single prod workspace) — the account-
// assigned timeline event links to the manager record.
const WORKSPACE_MEMBER_OBJECT_METADATA_ID =
  'b3c22c83-033d-4c0c-a312-8fcfedba7e55';

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
        await this.upsertPersonAssignment(workspaceId, authContext, opportunity);
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
      ownerId: string;
      projectId: string;
      pointOfContactId: string;
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

      return;
    }

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

  // Sticky (company × project) → manager (B2B account ownership), written on
  // claim. Idempotent; on a new/changed owner, emits an account-assigned event.
  private async upsertCompanyAssignment(
    workspaceId: string,
    opportunity: { id: string; ownerId: string; projectId: string; companyId: string },
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

  // account-assigned timeline event on the company, linked to the manager.
  private async recordAccountAssignedEvent(
    workspaceId: string,
    opportunity: { id: string; ownerId: string; projectId: string; companyId: string },
  ): Promise<void> {
    try {
      const workspaceMemberRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'workspaceMember',
          { shouldBypassPermissionChecks: true },
        );
      const projectRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'project',
          { shouldBypassPermissionChecks: true },
        );
      const companyRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'company',
          { shouldBypassPermissionChecks: true },
        );
      const manager = await workspaceMemberRepository.findOne({
        where: { id: opportunity.ownerId },
      });
      const project = await projectRepository.findOne({
        where: { id: opportunity.projectId },
      });
      const company = await companyRepository.findOne({
        where: { id: opportunity.companyId },
      });
      const managerName = manager?.name
        ? `${manager.name.firstName ?? ''} ${manager.name.lastName ?? ''}`.trim()
        : 'A manager';

      const segments: EnsoTimelineSegment[] = [
        {
          label: managerName,
          objectNameSingular: 'workspaceMember',
          recordId: opportunity.ownerId,
        },
        { text: ' became the account owner for ' },
        {
          label: company?.name || 'this company',
          objectNameSingular: 'company',
          recordId: opportunity.companyId,
        },
      ];

      if (project?.name) {
        segments.push(
          { text: ' on ' },
          {
            label: project.name,
            objectNameSingular: 'project',
            recordId: opportunity.projectId,
          },
        );
      }
      segments.push({
        text: ' — future leads from this company on this project route to them.',
      });

      const timelineRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'timelineActivity',
          { shouldBypassPermissionChecks: true },
        );

      const rows = buildEnsoTimelineInserts({
        action: 'account-assigned',
        target: { companyId: opportunity.companyId },
        segments,
        auto: true,
        linkedObjectMetadataId: WORKSPACE_MEMBER_OBJECT_METADATA_ID,
        linkedRecordId: opportunity.ownerId,
        linkedRecordCachedName: managerName,
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
}
