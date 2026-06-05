import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import {
  coerceTrafficType,
  mapOpportunitySource,
  SYSTEM_ACTOR,
} from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';

// Freezes the Person's FIRST-touch attribution from the earliest inbound activity
// — "what created this person": lead source (channel), traffic type + UTMs, the
// date, and a link to the creating activity. Runs per activity from the pipeline;
// updates the person only when this activity is the earliest seen (handles
// out-of-order arrival). Best-effort — never fails the pipeline.
@Injectable()
export class PersonFirstTouchService {
  private readonly logger = new Logger(PersonFirstTouchService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async applyFromActivity(
    authContext: WorkspaceAuthContext,
    activityId: string,
  ): Promise<void> {
    const workspaceId = authContext.workspace?.id;

    if (!workspaceId || !isDefined(activityId)) {
      return;
    }

    const systemAuthContext = buildSystemAuthContext(workspaceId);

    try {
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const activityRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'inboundActivity',
              { shouldBypassPermissionChecks: true },
            );

          const activity = await activityRepository.findOne({
            where: { id: activityId },
          });

          // Skip test/junk and activities not tied to a person.
          if (
            !activity ||
            activity.isSynthetic === true ||
            !isDefined(activity.personId)
          ) {
            return;
          }

          const personRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'person',
              { shouldBypassPermissionChecks: true },
            );

          const person = await personRepository.findOne({
            where: { id: activity.personId },
          });

          if (!person) {
            return;
          }

          const activityTime = activity.occurredAt ?? activity.createdAt;
          const currentFirst = person.firstTouchAt;

          // Only (re)write when this is the earliest activity for the person —
          // first-touch is immutable except when an earlier one arrives later.
          if (
            isDefined(currentFirst) &&
            isDefined(activityTime) &&
            new Date(activityTime) >= new Date(currentFirst)
          ) {
            return;
          }

          await personRepository.update(
            { id: person.id },
            {
              leadSource: mapOpportunitySource(activity.kind),
              firstTrafficType: coerceTrafficType(activity.trafficType),
              firstUtmSource: activity.utmSource ?? null,
              firstUtmMedium: activity.utmMedium ?? null,
              firstUtmCampaign: activity.utmCampaign ?? null,
              firstUtmContent: activity.utmContent ?? null,
              firstUtmTerm: activity.utmTerm ?? null,
              firstTouchAt: activityTime ?? null,
              createdByActivityId: activity.id,
              updatedBy: SYSTEM_ACTOR,
            },
          );
        },
        systemAuthContext,
      );
    } catch (error) {
      this.logger.warn(
        `Person first-touch failed for activity ${activityId}: ${(error as Error).message}`,
      );
    }
  }
}
