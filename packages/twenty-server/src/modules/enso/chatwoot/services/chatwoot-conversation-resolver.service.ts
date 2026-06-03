import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

// One conversation linked to a deal (via an inboundActivity carrying a
// chatwootConversationId).
export type DealConversation = {
  conversationId: string;
  platform: string | null;
  occurredAt: string | null;
};

// Shared lookup: all DISTINCT Chatwoot conversations attached to an opportunity,
// newest first. A deal can collect several (a person messaging across FB/IG, or
// multiple separate threads) — each inboundActivity carries one
// chatwootConversationId; we dedupe by that id and keep the most recent activity
// per conversation. Used by both the embed (list) and the on-claim push (assign
// them all).
@Injectable()
export class ChatwootConversationResolverService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async listForOpportunity(
    workspaceId: string,
    opportunityId: string,
  ): Promise<DealConversation[]> {
    const systemAuthContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const activityRepository =
          await this.globalWorkspaceOrmManager.getRepository<any>(
            workspaceId,
            'inboundActivity',
            { shouldBypassPermissionChecks: true },
          );

        const activities = await activityRepository.find({
          where: { opportunityId },
          order: { occurredAt: 'DESC', createdAt: 'DESC' },
        });

        const seen = new Set<string>();
        const conversations: DealConversation[] = [];

        for (const activity of activities) {
          const conversationId = activity.chatwootConversationId;

          if (!isDefined(conversationId) || seen.has(String(conversationId))) {
            continue;
          }

          seen.add(String(conversationId));
          conversations.push({
            conversationId: String(conversationId),
            platform: activity.platform ?? null,
            occurredAt: activity.occurredAt
              ? new Date(activity.occurredAt).toISOString()
              : null,
          });
        }

        return conversations;
      },
      systemAuthContext,
    );
  }
}
