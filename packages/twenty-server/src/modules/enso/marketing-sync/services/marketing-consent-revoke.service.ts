import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { SYSTEM_ACTOR } from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';
import { type ConsentUnsubscribeInput } from 'src/modules/enso/marketing-sync/dtos/consent-unsubscribe.input';
import {
  buildEnsoTimelineInserts,
  type EnsoTimelineSegment,
} from 'src/modules/enso/timeline/enso-timeline.util';

// Reverse consent mirror (Dittofeed → CRM). When a recipient unsubscribes in
// Dittofeed they enter that subscription group's "unsubscribed" segment; a
// reverse journey's Webhook node POSTs here, and we revoke the matching CRM
// consent. This is the FIRST CRM-side consent writer (consent is otherwise
// written by intake/n8n) — so it writes raw, mirroring how the journey-callback
// service writes marketingEnrollment: set the channel false + stamp RevokedAt,
// append a personProjectConsentEvent audit row (action REVOKED), drop a timeline
// sentence. The grant's original source/consentedAt are preserved (historical).
@Injectable()
export class MarketingConsentRevokeService {
  private readonly logger = new Logger(MarketingConsentRevokeService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async revoke(input: ConsentUnsubscribeInput): Promise<void> {
    const { workspaceId, userId, projectId, channel } = input;
    const method = input.method ?? 'UNSUBSCRIBE';
    const happenedAt = isDefined(input.occurredAt)
      ? input.occurredAt
      : new Date().toISOString();

    const consentField = `${channel}MarketingConsent`;
    const revokedAtField = `${channel}MarketingConsentRevokedAt`;
    const channelEnum = channel.toUpperCase();

    const authContext = buildSystemAuthContext(workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const consentRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'personProjectConsent',
          { shouldBypassPermissionChecks: true },
        );

      const row = await consentRepository.findOne({
        where: { personId: userId, projectId },
      });

      // No consent row, or this channel was never/already not granted → nothing
      // to revoke. Idempotent: a repeat unsubscribe is a no-op.
      if (!isDefined(row)) {
        this.logger.warn(
          `consent-unsubscribe: no personProjectConsent for person ${userId} / project ${projectId}`,
        );

        return;
      }

      if (row[consentField] !== true) {
        return;
      }

      await consentRepository.update(
        { id: row.id },
        {
          [consentField]: false,
          [revokedAtField]: happenedAt,
          // Raw update bypasses the resolver that fills updatedBy (NOT NULL).
          updatedBy: SYSTEM_ACTOR,
        },
      );

      await this.recordConsentEvent({
        workspaceId,
        userId,
        projectId,
        channelEnum,
        method,
        happenedAt,
      });

      await this.writeTimeline({ workspaceId, userId, channel, happenedAt });
    }, authContext);
  }

  // Append the immutable audit row the personProjectConsentEvent object exists
  // for. Best-effort: an audit failure must not roll back the revoke itself.
  private async recordConsentEvent(params: {
    workspaceId: string;
    userId: string;
    projectId: string;
    channelEnum: string;
    method: string;
    happenedAt: string;
  }): Promise<void> {
    try {
      const eventRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          params.workspaceId,
          'personProjectConsentEvent',
          { shouldBypassPermissionChecks: true },
        );

      await eventRepository.insert({
        name: `${params.channelEnum} REVOKED · ${params.method}`,
        personId: params.userId,
        projectId: params.projectId,
        channel: params.channelEnum,
        action: 'REVOKED',
        method: params.method,
        occurredAt: params.happenedAt,
        note: 'Unsubscribed via Dittofeed',
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
      });
    } catch (error) {
      this.logger.warn(
        `consent-unsubscribe audit-event write failed for person ${params.userId}: ${
          (error as Error).message
        }`,
      );
    }
  }

  // Best-effort green-sentence timeline event on the person.
  private async writeTimeline(params: {
    workspaceId: string;
    userId: string;
    channel: string;
    happenedAt: string;
  }): Promise<void> {
    try {
      const timelineRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          params.workspaceId,
          'timelineActivity',
          { shouldBypassPermissionChecks: true },
        );

      const segments: EnsoTimelineSegment[] = [
        { text: `Unsubscribed from ${params.channel} marketing` },
      ];

      const rows = buildEnsoTimelineInserts({
        action: 'marketing-unsubscribed',
        target: { personId: params.userId },
        segments,
        auto: true,
        happensAt: params.happenedAt,
      });

      if (rows.length > 0) {
        await timelineRepository.insert(rows);
      }
    } catch (error) {
      this.logger.warn(
        `consent-unsubscribe timeline write failed for person ${params.userId}: ${
          (error as Error).message
        }`,
      );
    }
  }
}
