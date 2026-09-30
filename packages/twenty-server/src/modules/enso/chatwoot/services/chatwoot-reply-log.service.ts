import { Injectable, Logger } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import {
  type ChatwootConversationMeta,
  type ChatwootMessage,
} from 'src/modules/enso/chatwoot/services/chatwoot-client.service';
import { type DealConversation } from 'src/modules/enso/chatwoot/services/chatwoot-conversation-resolver.service';
import { buildChatwootReplyOutbound } from 'src/modules/enso/chatwoot/utils/build-chatwoot-reply-outbound.util';
import { buildEnsoTimelineInserts } from 'src/modules/enso/timeline/enso-timeline.util';

// A reply sent from the in-CRM chat panel is a manager touch like a 1:1 email or
// SMS, so it is logged the same way: one outboundActivity attributed to the
// manager plus one enso timeline sentence on the person and the deal. Chatwoot
// has already delivered the message by the time this runs, so every failure here
// is logged and swallowed — it must never turn a sent reply into an error.
@Injectable()
export class ChatwootReplyLogService {
  private readonly logger = new Logger(ChatwootReplyLogService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async logReply(params: {
    workspaceId: string;
    conversation: DealConversation;
    meta: ChatwootConversationMeta | null;
    message: ChatwootMessage;
    content?: string;
    attachmentCount: number;
    workspaceMemberId?: string;
    senderName?: string;
  }): Promise<void> {
    const { workspaceId, conversation, meta, message, workspaceMemberId } =
      params;
    const personId = conversation.personId ?? undefined;
    const opportunityId = conversation.opportunityId ?? undefined;

    if (!isNonEmptyString(personId) && !isNonEmptyString(opportunityId)) {
      return;
    }

    const outbound = buildChatwootReplyOutbound({
      channelType: meta?.channelType ?? null,
      platform: conversation.platform,
      subject: meta?.mailSubject ?? null,
    });
    const subjectSegment = outbound.segments[1];
    const subject =
      isDefined(subjectSegment) && 'text' in subjectSegment
        ? subjectSegment.text
        : undefined;
    const attachmentNote =
      params.attachmentCount > 0
        ? `[${params.attachmentCount} attachment${params.attachmentCount === 1 ? '' : 's'}]`
        : '';
    const body = [params.content?.trim() ?? '', attachmentNote]
      .filter(isNonEmptyString)
      .join('\n');

    try {
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const outboundActivityRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'outboundActivity',
              { shouldBypassPermissionChecks: true },
            );

          await outboundActivityRepository.save({
            channel: outbound.channel,
            loggedVia: 'CRM_INITIATED',
            deliveryStatus: 'SENT',
            body,
            occurredAt: isNonEmptyString(message.createdAt)
              ? new Date(message.createdAt)
              : new Date(),
            externalId: String(message.id),
            externalThreadId: conversation.conversationId,
            ...(isNonEmptyString(subject) ? { subject } : {}),
            ...(isNonEmptyString(params.senderName)
              ? { fromIdentity: params.senderName }
              : {}),
            ...(isNonEmptyString(meta?.contactEmail)
              ? { toIdentity: meta.contactEmail }
              : isNonEmptyString(meta?.contactName)
                ? { toIdentity: meta.contactName }
                : {}),
            ...(isNonEmptyString(opportunityId) ? { opportunityId } : {}),
            ...(isNonEmptyString(personId) ? { personId } : {}),
            // The replying manager — so the touch reads "by <Manager>", not "System".
            ...(isNonEmptyString(workspaceMemberId)
              ? { performedById: workspaceMemberId }
              : {}),
          });

          const timelineRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'timelineActivity',
              { shouldBypassPermissionChecks: true },
            );

          const rows = buildEnsoTimelineInserts({
            action: outbound.action,
            target: {
              ...(isNonEmptyString(personId) ? { personId } : {}),
              ...(isNonEmptyString(opportunityId) ? { opportunityId } : {}),
            },
            segments: outbound.segments,
            ...(isNonEmptyString(workspaceMemberId)
              ? { workspaceMemberId }
              : { auto: true }),
            happensAt: new Date().toISOString(),
          });

          if (rows.length > 0) {
            await timelineRepository.insert(rows);
          }
        },
        buildSystemAuthContext(workspaceId),
      );
    } catch (error) {
      this.logger.warn(
        `chat panel reply logging failed for conversation ${conversation.conversationId}: ${
          (error as Error).message
        }`,
      );
    }
  }
}
