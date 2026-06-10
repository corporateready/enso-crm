import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';
import { ILike, In, Not } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { extractDomainFromLink } from 'src/modules/contact-creation-manager/utils/extract-domain-from-link.util';
import { getDomainNameFromHandle } from 'src/modules/contact-creation-manager/utils/get-domain-name-from-handle.util';
import {
  CLOSED_OPPORTUNITY_STAGES,
  coerceTrafficType,
  mapOpportunitySource,
  OPPORTUNITY_SOURCE_LABEL,
  SYSTEM_ACTOR,
} from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';
import { isCompanyAutomationEnabled } from 'src/modules/enso/company-enrichment/company-enrichment.constants';
import {
  buildEnsoTimelineInserts,
  type EnsoTimelineSegment,
} from 'src/modules/enso/timeline/enso-timeline.util';
import { isWorkEmail } from 'src/utils/is-work-email';

// Workspace-specific object metadata ids (single prod workspace) for timeline
// linkedObjectMetadataId — so attach events can link to the deal / company.
const OPPORTUNITY_OBJECT_METADATA_ID =
  'a71b2bcb-9380-4b84-9f94-b6ddc19b103b';
const INBOUND_ACTIVITY_OBJECT_METADATA_ID =
  'cef40992-41c4-4742-8b4c-234777a1b8c6';
import { ManagerNotificationService } from 'src/modules/enso/lead-pipeline/services/manager-notification.service';
import { OpportunityNameService } from 'src/modules/enso/lead-pipeline/services/opportunity-name.service';

// Result of resolving an inbound activity to an opportunity.
export type ResolutionResult = {
  opportunityId: string;
  // true → a fresh opportunity was created (needs routing);
  // false → the activity was attached to an existing open deal.
  created: boolean;
};

// Minimal shape we read off the activity. The workspace ORM exposes MANY_TO_ONE
// relations as flat `<name>Id` columns.
type ActivityRow = {
  id: string;
  name?: string | null;
  personId?: string | null;
  projectId?: string | null;
  opportunityId?: string | null;
  isSynthetic?: boolean | null;
  kind?: string | null;
  m2Requested?: number | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  trafficType?: string | null;
  landingPage?: string | null;
  roistatVisitId?: string | null;
};

// Turns one inbound activity into (or onto) an opportunity:
//   skip synthetic / incomplete / already-linked
//   → dedup: open deal for (person × project) within the window? attach : create
//   → seed the FROZEN first-touch attribution snapshot at creation.
// firstContactAt / firstContactChannel are deliberately NOT seeded here — they
// mark the manager's first human contact (the Routing → Connected trigger),
// not intake.
@Injectable()
export class OpportunityResolutionService {
  private readonly logger = new Logger(OpportunityResolutionService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly opportunityNameService: OpportunityNameService,
    private readonly managerNotificationService: ManagerNotificationService,
  ) {}

  async resolveFromActivity(
    authContext: WorkspaceAuthContext,
    activityId: string,
  ): Promise<ResolutionResult | null> {
    const workspaceId = authContext.workspace?.id;

    if (!workspaceId || !isDefined(activityId)) {
      return null;
    }

    const systemAuthContext = buildSystemAuthContext(workspaceId);

    // Set inside the attach branch when a re-engagement lands on an already-claimed
    // deal; the owner is pinged AFTER the workspace-context block (best-effort).
    let reengagementNotify: { managerId: string } | null = null;

    const result = await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const activityRepository =
          await this.globalWorkspaceOrmManager.getRepository<any>(
            workspaceId,
            'inboundActivity',
            { shouldBypassPermissionChecks: true },
          );

        const activity: ActivityRow | null = await activityRepository.findOne({
          where: { id: activityId },
        });

        if (!activity) {
          return null;
        }

        // Guards: don't create deals for test/junk data, leads with no identity,
        // or activities already linked to a deal (idempotency).
        if (activity.isSynthetic === true) {
          this.logger.log(
            `Activity ${activityId} is synthetic — no opportunity.`,
          );

          return null;
        }

        if (!isDefined(activity.personId) || !isDefined(activity.projectId)) {
          this.logger.warn(
            `Activity ${activityId} missing person/project — cannot resolve a deal.`,
          );

          return null;
        }

        if (isDefined(activity.opportunityId)) {
          return { opportunityId: activity.opportunityId, created: false };
        }

        const opportunityRepository =
          await this.globalWorkspaceOrmManager.getRepository<any>(
            workspaceId,
            'opportunity',
            { shouldBypassPermissionChecks: true },
          );

        // Determine B2B/B2C up front — it drives the dedup key. B2B = the contact
        // is linked to a company (work-email domain). Race-safe: if the
        // company-link job hasn't written person.companyId yet, fall back to a
        // read-only company-by-domain lookup, so (company × project) account
        // dedup is reliable from the first deal.
        const personRepository =
          await this.globalWorkspaceOrmManager.getRepository<any>(
            workspaceId,
            'person',
            { shouldBypassPermissionChecks: true },
          );
        const person = await personRepository.findOne({
          where: { id: activity.personId },
        });
        const companyId = await this.resolveCompanyId(workspaceId, person);
        // clientType label is always derived (harmless). The (company × project)
        // DEDUP behavior is gated by the master flag so it's a clean kill-switch:
        // off → falls back to the original (person × project) dedup.
        const clientType = isDefined(companyId) ? 'B2B' : 'B2C';
        const dedupByCompany =
          isDefined(companyId) && isCompanyAutomationEnabled();

        // Dedup over OPEN deals (any age; closed deals let a fresh inquiry open a
        // new one). B2B → (company × project): a NEW contact from the same company
        // attaches to the account's open deal. B2C → (person × project), as before.
        const existing = await opportunityRepository.findOne({
          where: dedupByCompany
            ? {
                companyId,
                projectId: activity.projectId,
                stage: Not(In([...CLOSED_OPPORTUNITY_STAGES])),
              }
            : {
                pointOfContactId: activity.personId,
                projectId: activity.projectId,
                stage: Not(In([...CLOSED_OPPORTUNITY_STAGES])),
              },
          order: { createdAt: 'DESC' },
        });

        if (existing) {
          await activityRepository.update(
            { id: activity.id },
            { opportunityId: existing.id },
          );

          // Re-engagement: refresh the LAST-touch attribution snapshot (first-touch
          // stays frozen) + bump the counter. Best-effort — a failure here must not
          // undo the attach above.
          try {
            await opportunityRepository.update(
              { id: existing.id },
              {
                lastTrafficType: coerceTrafficType(activity.trafficType),
                lastUtmSource: activity.utmSource ?? null,
                lastUtmMedium: activity.utmMedium ?? null,
                lastUtmCampaign: activity.utmCampaign ?? null,
                lastUtmContent: activity.utmContent ?? null,
                lastUtmTerm: activity.utmTerm ?? null,
                lastTouchAt: new Date().toISOString(),
                reengagementCount: (existing.reengagementCount ?? 0) + 1,
                updatedBy: SYSTEM_ACTOR,
              },
            );
          } catch (error) {
            this.logger.warn(
              `Last-touch update failed for deal ${existing.id}: ${(error as Error).message}`,
            );
          }

          // Rich timeline: surface the attach on the deal (and company/person),
          // linking the actual inbound activity + the contact.
          await this.recordAttachEvent(
            workspaceId,
            existing,
            { id: activity.id, name: activity.name },
            activity.personId,
            dedupByCompany,
            companyId,
          );

          // Ping the owner only when the deal is already claimed (out of ROUTING
          // with an owner) — during ROUTING the routing flow already notifies.
          if (isDefined(existing.ownerId) && existing.stage !== 'ROUTING') {
            reengagementNotify = { managerId: existing.ownerId };
          }

          this.logger.log(
            `Activity ${activityId} attached to existing opportunity ${existing.id} (${dedupByCompany ? 'B2B account' : 're-engagement'}).`,
          );

          return { opportunityId: existing.id, created: false };
        }

        const source = mapOpportunitySource(activity.kind);

        const name = await this.opportunityNameService.computeName(
          authContext,
          {
            personId: activity.personId,
            projectId: activity.projectId,
            source,
          },
        );

        const lastPosition = await opportunityRepository.maximum(
          'position',
          undefined,
        );

        // m2Requested is a single requested size; seed both ends of the initial
        // range (m2Final stays null until confirmed).
        const m2 = isDefined(activity.m2Requested)
          ? activity.m2Requested
          : undefined;

        // Generate the id app-side so we don't depend on parsing the driver's
        // InsertResult to get it back.
        const opportunityId = randomUUID();

        await opportunityRepository.insert({
          id: opportunityId,
          stage: 'ROUTING',
          pipelineState: 'ACTIVE',
          routingCount: 0,
          source,
          projectId: activity.projectId,
          pointOfContactId: activity.personId,
          // B2B/B2C classification + link the account (company) on B2B deals.
          clientType,
          ...(isDefined(companyId) ? { companyId } : {}),
          // Frozen first-touch attribution snapshot (immutable on the deal).
          utmSource: activity.utmSource ?? null,
          utmMedium: activity.utmMedium ?? null,
          utmCampaign: activity.utmCampaign ?? null,
          utmContent: activity.utmContent ?? null,
          utmTerm: activity.utmTerm ?? null,
          firstTrafficType: coerceTrafficType(activity.trafficType),
          firstLandingPage: activity.landingPage ?? null,
          roistatVisitId: activity.roistatVisitId ?? null,
          ...(isDefined(m2) ? { m2Min: m2, m2Max: m2 } : {}),
          position: (lastPosition ?? 0) + 1,
          createdBy: SYSTEM_ACTOR,
          updatedBy: SYSTEM_ACTOR,
          ...(isDefined(name) ? { name } : {}),
        });

        await activityRepository.update({ id: activity.id }, { opportunityId });

        // Rich provenance on the timeline: a B2B/B2C deal opened from this inbound
        // activity, by ENSO CRM. Replaces the generic "created by" row.
        await this.recordCreatedEvent(workspaceId, {
          opportunityId,
          clientType,
          companyId,
          personId: activity.personId,
          source,
          activityId: activity.id,
          activityName: activity.name,
          dealName: name,
        });

        this.logger.log(
          `Created ${clientType} opportunity ${opportunityId} from activity ${activityId}.`,
        );

        return { opportunityId, created: true };
      },
      systemAuthContext,
    );

    if (isDefined(reengagementNotify) && isDefined(result)) {
      try {
        await this.managerNotificationService.notifyReengagement(authContext, {
          opportunityId: result.opportunityId,
          managerId: reengagementNotify.managerId,
        });
      } catch (error) {
        this.logger.warn(
          `Re-engagement notify failed for deal ${result.opportunityId}: ${(error as Error).message}`,
        );
      }
    }

    return result;
  }

  // Resolve the contact's company for B2B classification + (company × project)
  // dedup. Prefers person.companyId; if unset (the company-link job may not have
  // landed yet), falls back to a read-only lookup of the company by the person's
  // work-email domain. Read-only — never creates a company (that's the
  // company-enrichment flow's job; creating here would skip its enrichment).
  private async resolveCompanyId(
    workspaceId: string,
    person: {
      companyId?: string | null;
      emails?: {
        primaryEmail?: string | null;
        additionalEmails?: string[] | null;
      } | null;
    } | null,
  ): Promise<string | null> {
    if (isDefined(person?.companyId)) {
      return person.companyId;
    }

    const domain = this.workEmailDomain(person);

    if (!domain) {
      return null;
    }

    const companyRepository =
      await this.globalWorkspaceOrmManager.getRepository<any>(
        workspaceId,
        'company',
        { shouldBypassPermissionChecks: true },
      );

    const candidates = await companyRepository.find({
      where: { domainName: { primaryLinkUrl: ILike(`%${domain}%`) } },
    });
    const match = candidates.find(
      (company: { domainName?: { primaryLinkUrl?: string } }) =>
        isDefined(company.domainName?.primaryLinkUrl) &&
        extractDomainFromLink(company.domainName.primaryLinkUrl) === domain,
    );

    return match?.id ?? null;
  }

  // First work-email registrable domain on the person, or null (personal only).
  private workEmailDomain(
    person: {
      emails?: {
        primaryEmail?: string | null;
        additionalEmails?: string[] | null;
      } | null;
    } | null,
  ): string | null {
    const emails = [
      person?.emails?.primaryEmail,
      ...(person?.emails?.additionalEmails ?? []),
    ].filter((email): email is string => isDefined(email) && email.length > 0);

    for (const email of emails) {
      if (isWorkEmail(email)) {
        const domain = getDomainNameFromHandle(email);

        if (domain) {
          return domain;
        }
      }
    }

    return null;
  }

  // Plain-English timeline event when an activity attaches to an existing open
  // deal — shown on the deal, the company (B2B) and the person, linking the
  // actual inbound activity + the contact. Best-effort.
  private async recordAttachEvent(
    workspaceId: string,
    opportunity: { id: string; name?: string | null },
    activity: { id: string; name?: string | null },
    personId: string,
    isB2b: boolean,
    companyId: string | null,
  ): Promise<void> {
    try {
      const personName = await this.lookupName(workspaceId, 'person', personId);
      const companyName =
        isB2b && isDefined(companyId)
          ? await this.lookupName(workspaceId, 'company', companyId)
          : null;
      const activityLabel = activity.name || 'an inbound activity';

      const segments: EnsoTimelineSegment[] = [
        {
          label: activityLabel,
          objectNameSingular: 'inboundActivity',
          recordId: activity.id,
        },
        { text: ' was added to this deal — ' },
        { label: personName, objectNameSingular: 'person', recordId: personId },
      ];

      if (isB2b && isDefined(companyId)) {
        segments.push(
          { text: ' is another contact at ' },
          {
            label: companyName ?? 'the same company',
            objectNameSingular: 'company',
            recordId: companyId,
          },
          { text: ' working on this project.' },
        );
      } else {
        segments.push({ text: ' reached out again about this project.' });
      }

      const timelineRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'timelineActivity',
          { shouldBypassPermissionChecks: true },
        );

      const rows = buildEnsoTimelineInserts({
        action: 'deal-activity-attached',
        target: {
          opportunityId: opportunity.id,
          personId,
          inboundActivityId: activity.id,
          ...(isB2b && isDefined(companyId) ? { companyId } : {}),
        },
        segments,
        auto: true,
        // icon + fallback click target = the inbound activity that was added.
        linkedObjectMetadataId: INBOUND_ACTIVITY_OBJECT_METADATA_ID,
        linkedRecordId: activity.id,
        linkedRecordCachedName: activityLabel,
      });

      if (rows.length > 0) {
        await timelineRepository.insert(rows);
      }
    } catch (error) {
      this.logger.warn(
        `Attach timeline write failed for deal ${opportunity.id}: ${
          (error as Error).message
        }`,
      );
    }
  }

  // Plain-English "deal opened" event — replaces the generic created-by row.
  // Reads e.g. "{Deal | Alice · …} was opened as a B2B deal from {Form · …} —
  // by ENSO CRM", on the deal + person + inbound activity (+ company for B2B).
  // Best-effort.
  private async recordCreatedEvent(
    workspaceId: string,
    params: {
      opportunityId: string;
      clientType: string;
      companyId: string | null;
      personId: string;
      source: string;
      activityId: string;
      activityName?: string | null;
      dealName?: string | null;
    },
  ): Promise<void> {
    try {
      const isB2b = params.clientType === 'B2B';
      const fromLabel = OPPORTUNITY_SOURCE_LABEL[params.source] ?? 'lead';
      const activityLabel =
        params.activityName || `an inbound ${fromLabel.toLowerCase()}`;
      const dealLabel = params.dealName || 'A deal';

      const segments: EnsoTimelineSegment[] = [
        {
          label: dealLabel,
          objectNameSingular: 'opportunity',
          recordId: params.opportunityId,
        },
        { text: ` was opened as a ${params.clientType} deal from ` },
        {
          label: activityLabel,
          objectNameSingular: 'inboundActivity',
          recordId: params.activityId,
        },
        { text: '.' },
      ];

      const timelineRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'timelineActivity',
          { shouldBypassPermissionChecks: true },
        );

      const rows = buildEnsoTimelineInserts({
        action: 'deal-created',
        target: {
          personId: params.personId,
          opportunityId: params.opportunityId,
          inboundActivityId: params.activityId,
          ...(isB2b && isDefined(params.companyId)
            ? { companyId: params.companyId }
            : {}),
        },
        segments,
        auto: true,
        linkedObjectMetadataId: INBOUND_ACTIVITY_OBJECT_METADATA_ID,
        linkedRecordId: params.activityId,
        linkedRecordCachedName: activityLabel,
      });

      if (rows.length > 0) {
        await timelineRepository.insert(rows);
      }
    } catch (error) {
      this.logger.warn(
        `Created timeline write failed for deal ${params.opportunityId}: ${
          (error as Error).message
        }`,
      );
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
