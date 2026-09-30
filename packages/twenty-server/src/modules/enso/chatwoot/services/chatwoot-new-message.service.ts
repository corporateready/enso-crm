import { Injectable, Logger } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';

import { InjectCacheStorage } from 'src/engine/core-modules/cache-storage/decorators/cache-storage.decorator';
import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { ChatwootClientService } from 'src/modules/enso/chatwoot/services/chatwoot-client.service';
import { decideNewMessageNotification } from 'src/modules/enso/chatwoot/utils/decide-new-message-notification.util';
import { CLOSED_OPPORTUNITY_STAGES } from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';
import { ManagerNotificationService } from 'src/modules/enso/lead-pipeline/services/manager-notification.service';

const NOTIFIED_TTL_MS = 2 * 24 * 60 * 60 * 1000;

// "Your lead wrote back" for an ongoing conversation. Chatwoot pushes every
// message_created here; the payload is treated as a hint only — the message is
// re-read from Chatwoot by id and must be a recent lead message, so a forged or
// replayed event can at most re-trigger a real, fresh notification (and the
// per-message cache stops even that). Best-effort throughout: nothing here may
// throw back into the webhook.
@Injectable()
export class ChatwootNewMessageService {
  private readonly logger = new Logger(ChatwootNewMessageService.name);

  constructor(
    private readonly chatwootClient: ChatwootClientService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly managerNotificationService: ManagerNotificationService,
    @InjectCacheStorage(CacheStorageNamespace.ModuleEnsoChatwoot)
    private readonly cacheStorage: CacheStorageService,
  ) {}

  async handleMessageCreated(payload: {
    event?: string;
    id?: number;
    message_type?: string | number;
    private?: boolean;
    account?: { id?: number | string };
    conversation?: { id?: number | string; channel?: string };
  }): Promise<void> {
    try {
      await this.process(payload);
    } catch (error) {
      this.logger.warn(
        `new-message notification failed for message ${payload?.id}: ${
          (error as Error).message
        }`,
      );
    }
  }

  private async process(payload: {
    event?: string;
    id?: number;
    message_type?: string | number;
    private?: boolean;
    account?: { id?: number | string };
    conversation?: { id?: number | string; channel?: string };
  }): Promise<void> {
    const workspaceId = process.env.ENSO_TELEPHONY_WORKSPACE_ID;
    const conversationId = payload?.conversation?.id;
    const messageId = payload?.id;

    // Cheap filters on the hint before any round-trip.
    if (
      payload?.event !== 'message_created' ||
      !(payload.message_type === 'incoming' || payload.message_type === 0) ||
      payload.private === true ||
      String(payload.account?.id ?? '') !== this.chatwootClient.accountId ||
      !isDefined(conversationId) ||
      typeof messageId !== 'number' ||
      !isNonEmptyString(workspaceId)
    ) {
      return;
    }

    const cacheKey = `new-message-notified:${messageId}`;

    if (isDefined(await this.cacheStorage.get<boolean>(cacheKey))) {
      return;
    }

    const messages = await this.chatwootClient.listMessages(conversationId);
    const decision = decideNewMessageNotification({
      messages,
      messageId,
      nowMs: Date.now(),
    });

    if (!decision.notify) {
      this.logger.debug(
        `new-message notification skipped for message ${messageId}: ${decision.reason}`,
      );

      return;
    }

    const deal = await this.findOpenOwnedDeal(
      workspaceId,
      String(conversationId),
    );

    if (!isDefined(deal)) {
      return;
    }

    await this.cacheStorage.set(cacheKey, true, NOTIFIED_TTL_MS);

    const meta = await this.chatwootClient
      .getConversationMeta(conversationId)
      .catch(() => null);

    await this.managerNotificationService.notifyNewMessage({
      workspaceId,
      opportunityId: deal.opportunityId,
      managerId: deal.ownerId,
      channelLabel: channelLabel(
        deal.platform,
        meta?.channelType ?? payload.conversation?.channel ?? null,
      ),
      preview:
        decision.message.content.trim() ||
        (decision.message.attachments.length > 0 ? '[attachment]' : ''),
    });
  }

  // The deal this conversation feeds: the newest inbound activity carrying the
  // conversation id and a deal, and only while that deal is open and owned (an
  // unclaimed deal is still routing and gets the assignment notice instead).
  private async findOpenOwnedDeal(
    workspaceId: string,
    conversationId: string,
  ): Promise<
    | { opportunityId: string; ownerId: string; platform: string | null }
    | undefined
  > {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const activityRepository =
          await this.globalWorkspaceOrmManager.getRepository<any>(
            workspaceId,
            'inboundActivity',
            { shouldBypassPermissionChecks: true },
          );
        const opportunityRepository =
          await this.globalWorkspaceOrmManager.getRepository<any>(
            workspaceId,
            'opportunity',
            { shouldBypassPermissionChecks: true },
          );

        const activities = await activityRepository.find({
          where: { chatwootConversationId: conversationId },
          order: { occurredAt: 'DESC', createdAt: 'DESC' },
          take: 10,
        });
        const activity = activities.find((candidate: any) =>
          isNonEmptyString(candidate.opportunityId),
        );

        if (!isDefined(activity)) {
          return undefined;
        }

        const opportunity = await opportunityRepository.findOne({
          where: { id: activity.opportunityId },
        });

        if (
          !isDefined(opportunity) ||
          !isNonEmptyString(opportunity.ownerId) ||
          (CLOSED_OPPORTUNITY_STAGES as readonly string[]).includes(
            opportunity.stage,
          )
        ) {
          return undefined;
        }

        return {
          opportunityId: opportunity.id,
          ownerId: opportunity.ownerId,
          platform: activity.platform ?? null,
        };
      },
      buildSystemAuthContext(workspaceId),
    );
  }
}

// "INSTAGRAM" / "Channel::Email" → "Instagram" / "Email", for the card title.
const channelLabel = (
  platform: string | null,
  channelType: string | null,
): string | null => {
  const raw = (platform || channelType || '').replace(/^Channel::/, '');
  const lower = raw.toLowerCase();

  if (lower.includes('insta')) return 'Instagram';
  if (lower.includes('face') || lower.includes('messenger')) return 'Facebook';
  if (lower.includes('whats')) return 'WhatsApp';
  if (lower.includes('email')) return 'Email';
  if (lower.includes('tele')) return 'Telegram';

  return raw.length > 0 ? raw : null;
};
