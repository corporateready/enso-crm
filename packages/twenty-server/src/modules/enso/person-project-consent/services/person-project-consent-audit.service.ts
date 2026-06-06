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
      const wasGranted = existing?.[`${channel}MarketingConsent`] === true;

      if (newValue === true && !wasGranted) {
        // Manual grant. Default the source to VERBAL only when the caller did
        // not specify one (so an explicit source — DOUBLE_OPT_IN, etc. — wins).
        if (!isDefined(data[`${channel}MarketingConsentSource`])) {
          stamps[`${channel}MarketingConsentSource`] = 'VERBAL';
        }
        stamps[`${channel}MarketingConsentedAt`] = nowIso;
        stamps[`${channel}MarketingConsentRevokedAt`] = null;
      } else if (newValue === false && wasGranted) {
        // Manual revoke.
        stamps[`${channel}MarketingConsentRevokedAt`] = nowIso;
      }
    }

    return stamps;
  }
}
