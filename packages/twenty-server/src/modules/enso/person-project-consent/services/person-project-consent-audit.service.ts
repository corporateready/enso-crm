import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

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

    for (const channel of touchedChannels) {
      const newValue = data[`${channel}MarketingConsent`];
      const currentlyGranted =
        existing?.[`${channel}MarketingConsent`] === true;
      // Whether this channel was EVER granted (a real consentedAt exists), even
      // if currently revoked. This is what protects expensive form provenance.
      const hadPriorConsent = isDefined(
        existing?.[`${channel}MarketingConsentedAt`],
      );

      if (newValue === true && !currentlyGranted) {
        if (hadPriorConsent) {
          // Re-grant of a channel that was consented before (e.g. a form
          // consent that got revoked, or an accidental toggle): just clear the
          // revoke. NEVER overwrite the original source/date — that's the
          // provenance we must preserve (e.g. FORM_WEBSITE + the form date).
          stamps[`${channel}MarketingConsentRevokedAt`] = null;
        } else {
          // First-ever grant for this channel. Default source to VERBAL unless
          // the caller specified one (FORM_WEBSITE from the pipeline, etc.).
          if (!isDefined(data[`${channel}MarketingConsentSource`])) {
            stamps[`${channel}MarketingConsentSource`] = 'VERBAL';
          }
          stamps[`${channel}MarketingConsentedAt`] = nowIso;
          stamps[`${channel}MarketingConsentRevokedAt`] = null;
        }
      } else if (newValue === false && currentlyGranted) {
        // Revoke. Stamp revokedAt but KEEP the original source/consentedAt as
        // the historical record of how/when consent was first obtained.
        stamps[`${channel}MarketingConsentRevokedAt`] = nowIso;
      }
    }

    return stamps;
  }
}
