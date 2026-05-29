import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';
import { In, MoreThan, Not } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import {
  CLOSED_OPPORTUNITY_STAGES,
  coerceTrafficType,
  DEAL_DEDUP_WINDOW_MS,
  mapOpportunitySource,
  SYSTEM_ACTOR,
} from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';
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

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
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

        // Dedup: an OPEN deal for this (person × project) within the window.
        const windowStart = new Date(Date.now() - DEAL_DEDUP_WINDOW_MS);

        const existing = await opportunityRepository.findOne({
          where: {
            pointOfContactId: activity.personId,
            projectId: activity.projectId,
            stage: Not(In([...CLOSED_OPPORTUNITY_STAGES])),
            createdAt: MoreThan(windowStart),
          },
          order: { createdAt: 'DESC' },
        });

        if (existing) {
          await activityRepository.update(
            { id: activity.id },
            { opportunityId: existing.id },
          );

          this.logger.log(
            `Activity ${activityId} attached to existing opportunity ${existing.id}.`,
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

        this.logger.log(
          `Created opportunity ${opportunityId} from activity ${activityId}.`,
        );

        return { opportunityId, created: true };
      },
      systemAuthContext,
    );
  }
}
