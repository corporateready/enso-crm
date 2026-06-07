import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { SYSTEM_ACTOR } from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';
import { PersonTimelineService } from 'src/modules/enso/lead-pipeline/services/person-timeline.service';
import { ConsentEventService } from 'src/modules/enso/person-project-consent/services/consent-event.service';
import { PersonProjectConsentNameService } from 'src/modules/enso/person-project-consent/services/person-project-consent-name.service';

// Establishes per-project marketing consent from an inbound activity — the
// channel-agnostic analog of the opportunity/attribution steps. Only form-type
// inbounds (website form / lead ad, where Terms+Privacy are accepted) grant
// marketing consent; a social DM or inbound call grants a reply/service window,
// NOT marketing consent, so those are skipped here. Verbal consent ("call me at
// …") is captured manually with source VERBAL, not from this hook. Best-effort:
// never fails the pipeline.
//
// kind → consent source. Absence = no marketing consent granted.
const KIND_TO_CONSENT_SOURCE: Record<string, string> = {
  FORM_SUBMISSION: 'FORM_WEBSITE',
  LEAD_AD: 'LEAD_AD',
};

// Human label for the timeline summary line.
const SOURCE_LABEL: Record<string, string> = {
  FORM_WEBSITE: 'Website form',
  LEAD_AD: 'Lead ad',
};

// Channels granted per available contact point. Email needs an email; the
// phone-based channels (SMS, WhatsApp, outbound call) need a phone number.
const EMAIL_CHANNELS = ['email'] as const;
const PHONE_CHANNELS = ['sms', 'whatsapp', 'call'] as const;

@Injectable()
export class ConsentFromActivityService {
  private readonly logger = new Logger(ConsentFromActivityService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly personProjectConsentNameService: PersonProjectConsentNameService,
    private readonly consentEventService: ConsentEventService,
    private readonly personTimelineService: PersonTimelineService,
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

    // Captured inside the workspace-context block; the append-only events are
    // emitted AFTER it (each event opens its own context — avoid nesting).
    let granted: {
      personId: string;
      projectId: string;
      channels: string[];
      source: string;
      consentedAt: string;
    } | null = null;

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

          // Consent is per person × project; skip test/junk and activities not
          // tied to both.
          if (
            !activity ||
            activity.isSynthetic === true ||
            !isDefined(activity.personId) ||
            !isDefined(activity.projectId)
          ) {
            return;
          }

          // Only form-type inbounds carry T&C acceptance → marketing consent.
          // Social / calls grant a reply window, not marketing consent.
          const source = KIND_TO_CONSENT_SOURCE[activity.kind];

          if (!isDefined(source)) {
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

          // The workspace ORM returns composites nested.
          const hasEmail = isNonEmptyString(person?.emails?.primaryEmail);
          const hasPhone = isNonEmptyString(person?.phones?.primaryPhoneNumber);

          const channels = [
            ...(hasEmail ? EMAIL_CHANNELS : []),
            ...(hasPhone ? PHONE_CHANNELS : []),
          ];

          if (channels.length === 0) {
            return;
          }

          const consentedAt =
            activity.occurredAt ?? activity.createdAt ?? new Date().toISOString();

          granted = {
            personId: activity.personId,
            projectId: activity.projectId,
            channels: [...channels],
            source,
            consentedAt,
          };

          // Set the granted channels true; clear any prior revoke (a fresh form
          // submission with T&C is a fresh opt-in — the re-grant policy).
          const channelFields: Record<string, unknown> = {};

          for (const channel of channels) {
            channelFields[`${channel}MarketingConsent`] = true;
            channelFields[`${channel}MarketingConsentSource`] = source;
            channelFields[`${channel}MarketingConsentedAt`] = consentedAt;
            channelFields[`${channel}MarketingConsentRevokedAt`] = null;
          }

          const consentRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'personProjectConsent',
              { shouldBypassPermissionChecks: true },
            );

          const existing = await consentRepository.findOne({
            where: {
              personId: activity.personId,
              projectId: activity.projectId,
            },
          });

          if (existing) {
            await consentRepository.update(
              { id: existing.id },
              { ...channelFields, updatedBy: SYSTEM_ACTOR },
            );

            return;
          }

          // Raw insert bypasses the create resolver, so materialize the
          // composite name + position + SYSTEM actor ourselves (same as the
          // other pipeline writes).
          const name = await this.personProjectConsentNameService.computeName(
            systemAuthContext,
            { personId: activity.personId, projectId: activity.projectId },
          );

          const lastPosition = await consentRepository.maximum(
            'position',
            undefined,
          );

          await consentRepository.insert({
            id: randomUUID(),
            personId: activity.personId,
            projectId: activity.projectId,
            ...channelFields,
            position: (lastPosition ?? 0) + 1,
            createdBy: SYSTEM_ACTOR,
            updatedBy: SYSTEM_ACTOR,
            ...(isDefined(name) ? { name } : {}),
          });
        },
        systemAuthContext,
      );
    } catch (error) {
      this.logger.warn(
        `Consent from activity failed for activity ${activityId}: ${(error as Error).message}`,
      );
    }

    // Append-only audit log: one GRANTED event per channel, linked to the
    // activity as evidence. Best-effort, emitted outside the write context.
    if (isDefined(granted)) {
      const grantedNonNull = granted as NonNullable<typeof granted>;
      let firstEventId: string | null = null;

      for (const channel of grantedNonNull.channels) {
        const eventId = await this.consentEventService.record(workspaceId, {
          personId: grantedNonNull.personId,
          projectId: grantedNonNull.projectId,
          channel,
          action: 'GRANTED',
          source: grantedNonNull.source,
          occurredAt: grantedNonNull.consentedAt,
          inboundActivityId: activityId,
          actor: { source: 'SYSTEM', name: 'System', context: {} },
        });

        if (!isDefined(firstEventId)) {
          firstEventId = eventId;
        }
      }

      // One aggregated row on the person's main timeline for the whole grant.
      if (isDefined(firstEventId)) {
        await this.personTimelineService.recordConsentChange(workspaceId, {
          personId: grantedNonNull.personId,
          projectId: grantedNonNull.projectId,
          consentEventId: firstEventId,
          action: 'GRANTED',
          channels: grantedNonNull.channels,
          detail: SOURCE_LABEL[grantedNonNull.source] ?? grantedNonNull.source,
          auto: true,
          happensAt: grantedNonNull.consentedAt,
        });
      }
    }
  }
}
