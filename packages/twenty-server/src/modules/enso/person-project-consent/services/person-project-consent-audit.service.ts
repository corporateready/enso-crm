import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { PersonTimelineService } from 'src/modules/enso/lead-pipeline/services/person-timeline.service';
import {
  type ConsentEventActor,
  ConsentEventService,
} from 'src/modules/enso/person-project-consent/services/consent-event.service';

// Pretty-print a SELECT code for the timeline summary (VERBAL → "Verbal",
// IN_CHAT → "In chat").
const prettyCode = (code?: string | null): string | null => {
  if (!isDefined(code) || code === '') {
    return null;
  }

  return code
    .toLowerCase()
    .split('_')
    .map((word, index) =>
      index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word,
    )
    .join(' ');
};

// Maintains the per-channel consent audit fields when a HUMAN edits a consent
// row via the API/UI (the resolver path). On a manual GRANT (channel flips to
// true) we default the source to VERBAL — the "person told us in conversation"
// case (e.g. they gave a phone number to be called) — stamp consentedAt, and
// clear any prior revoke. On a manual REVOKE (channel flips to false) we stamp
// revokedAt. The actor (who) is captured by the resolver's updatedBy.
//
// The pipeline's ConsentFromActivityService writes via the raw workspace ORM,
// which BYPASSES query hooks, so this only ever fires for manual edits — no
// conflict with the form-intake (FORM_WEBSITE) grants.
const CONSENT_CHANNELS = ['email', 'sms', 'whatsapp', 'call'] as const;

@Injectable()
export class PersonProjectConsentAuditService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly consentEventService: ConsentEventService,
    private readonly personTimelineService: PersonTimelineService,
  ) {}

  // Returns the audit-field stamps to merge into the write payload. `recordId`
  // is set on update (so we can compare against the prior state); on create it
  // is undefined and any channel set to true is treated as a fresh grant.
  async computeAuditStamps(
    authContext: WorkspaceAuthContext,
    data: Record<string, unknown>,
    recordId?: string,
  ): Promise<Record<string, unknown>> {
    const workspaceId = authContext.workspace?.id;

    if (!workspaceId || !isDefined(data)) {
      return {};
    }

    const touchedChannels = CONSENT_CHANNELS.filter(
      (channel) => `${channel}MarketingConsent` in data,
    );

    if (touchedChannels.length === 0) {
      return {};
    }

    const nowIso = new Date().toISOString();

    let existing: Record<string, unknown> | null = null;

    if (isDefined(recordId)) {
      const systemAuthContext = buildSystemAuthContext(workspaceId);

      existing = await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const repository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'personProjectConsent',
              { shouldBypassPermissionChecks: true },
            );

          return repository.findOne({ where: { id: recordId } });
        },
        systemAuthContext,
      );
    }

    const stamps: Record<string, unknown> = {};
    const transitions: {
      channel: string;
      action: 'GRANTED' | 'REVOKED';
      source?: string | null;
    }[] = [];

    for (const channel of touchedChannels) {
      const newValue = data[`${channel}MarketingConsent`];
      const currentlyGranted =
        existing?.[`${channel}MarketingConsent`] === true;
      // Whether this channel was EVER granted (a real consentedAt exists), even
      // if currently revoked. This is what protects expensive form provenance.
      const hadPriorConsent = isDefined(
        existing?.[`${channel}MarketingConsentedAt`],
      );
      const dataSource = data[`${channel}MarketingConsentSource`] as
        | string
        | undefined;
      const existingSource = existing?.[`${channel}MarketingConsentSource`] as
        | string
        | undefined;

      if (newValue === true && !currentlyGranted) {
        if (hadPriorConsent) {
          // Re-grant of a channel that was consented before (e.g. a form
          // consent that got revoked, or an accidental toggle): just clear the
          // revoke. NEVER overwrite the original source/date — that's the
          // provenance we must preserve (e.g. FORM_WEBSITE + the form date).
          stamps[`${channel}MarketingConsentRevokedAt`] = null;
          transitions.push({
            channel,
            action: 'GRANTED',
            source: existingSource ?? dataSource ?? 'VERBAL',
          });
        } else {
          // First-ever grant for this channel. Default source to VERBAL unless
          // the caller specified one (FORM_WEBSITE from the pipeline, etc.).
          if (!isDefined(dataSource)) {
            stamps[`${channel}MarketingConsentSource`] = 'VERBAL';
          }
          stamps[`${channel}MarketingConsentedAt`] = nowIso;
          stamps[`${channel}MarketingConsentRevokedAt`] = null;
          transitions.push({
            channel,
            action: 'GRANTED',
            source: dataSource ?? 'VERBAL',
          });
        }
      } else if (newValue === false && currentlyGranted) {
        // Revoke. Stamp revokedAt but KEEP the original source/consentedAt as
        // the historical record of how/when consent was first obtained.
        stamps[`${channel}MarketingConsentRevokedAt`] = nowIso;
        transitions.push({
          channel,
          action: 'REVOKED',
          source: existingSource,
        });
      }
    }

    // Append-only audit log (best-effort). Emitted after computing stamps; the
    // pipeline writes its own events directly (it bypasses this hook).
    if (transitions.length > 0) {
      const personId = (data.personId ?? existing?.personId) as
        | string
        | undefined;
      const projectId = (data.projectId ?? existing?.projectId) as
        | string
        | undefined;
      // The card conveys the "why" (free-text) + the revoke "how" via these row
      // fields on the same update; fall back to the existing row.
      const reason = (data.lastChangeReason ?? existing?.lastChangeReason) as
        | string
        | undefined;
      const revokeMethod = (data.lastRevokeMethod ??
        existing?.lastRevokeMethod) as string | undefined;

      if (isDefined(personId) && isDefined(projectId)) {
        let actor: ConsentEventActor = {
          source: 'MANUAL',
          name: 'Manual',
          context: {},
        };

        if (authContext.type === 'user') {
          const memberName = (
            authContext.workspaceMember as unknown as {
              name?: { firstName?: string; lastName?: string };
            }
          )?.name;
          actor = {
            source: 'MANUAL',
            workspaceMemberId: authContext.workspaceMemberId,
            name:
              `${memberName?.firstName ?? ''} ${memberName?.lastName ?? ''}`.trim() ||
              'Manager',
            context: {},
          };
        }

        // Collect a representative event id per action so each action gets one
        // aggregated row on the person's main timeline (grants and revokes are
        // separate rows even within the same edit).
        const grantedChannels: string[] = [];
        const revokedChannels: string[] = [];
        let firstGrantEventId: string | null = null;
        let firstRevokeEventId: string | null = null;
        let grantSource: string | null = null;

        for (const transition of transitions) {
          const eventId = await this.consentEventService.record(workspaceId, {
            personId,
            projectId,
            channel: transition.channel,
            action: transition.action,
            source: transition.source,
            // Revokes record the "how"; default a manual toggle to MANUAL.
            method:
              transition.action === 'REVOKED'
                ? (revokeMethod ?? 'MANUAL')
                : null,
            note: reason ?? null,
            actor,
          });

          if (transition.action === 'GRANTED') {
            grantedChannels.push(transition.channel);
            firstGrantEventId = firstGrantEventId ?? eventId;
            grantSource = grantSource ?? transition.source ?? null;
          } else {
            revokedChannels.push(transition.channel);
            firstRevokeEventId = firstRevokeEventId ?? eventId;
          }
        }

        if (isDefined(firstGrantEventId) && grantedChannels.length > 0) {
          await this.personTimelineService.recordConsentChange(workspaceId, {
            personId,
            projectId,
            consentEventId: firstGrantEventId,
            action: 'GRANTED',
            channels: grantedChannels,
            detail: prettyCode(grantSource),
            happensAt: nowIso,
          });
        }

        if (isDefined(firstRevokeEventId) && revokedChannels.length > 0) {
          await this.personTimelineService.recordConsentChange(workspaceId, {
            personId,
            projectId,
            consentEventId: firstRevokeEventId,
            action: 'REVOKED',
            channels: revokedChannels,
            detail: prettyCode(revokeMethod ?? 'MANUAL'),
            happensAt: nowIso,
          });
        }
      }
    }

    return stamps;
  }
}
