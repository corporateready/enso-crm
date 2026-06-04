import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';
import { In } from 'typeorm';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

// One conversation linked to a record (via an inboundActivity carrying a
// chatwootConversationId). For the person view we also carry which opportunity
// the conversation belongs to, so the UI can label it.
export type DealConversation = {
  conversationId: string;
  platform: string | null;
  occurredAt: string | null;
  opportunityId: string | null;
  opportunityName: string | null;
};

// Resolves the DISTINCT Chatwoot conversations attached to a record, newest
// first (dedup by chatwootConversationId, keep the most recent activity per
// conversation). For an opportunity → that deal's conversations; for a person →
// every conversation across all their deals, each labelled with its opportunity.
@Injectable()
export class ChatwootConversationResolverService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async listForOpportunity(
    workspaceId: string,
    opportunityId: string,
  ): Promise<DealConversation[]> {
    return this.list(workspaceId, { opportunityId });
  }

  async listForPerson(
    workspaceId: string,
    personId: string,
  ): Promise<DealConversation[]> {
    return this.list(workspaceId, { personId });
  }

  async listForRecord(
    workspaceId: string,
    recordType: 'opportunity' | 'person',
    recordId: string,
  ): Promise<DealConversation[]> {
    return recordType === 'person'
      ? this.listForPerson(workspaceId, recordId)
      : this.listForOpportunity(workspaceId, recordId);
  }

  private async list(
    workspaceId: string,
    where: { opportunityId?: string; personId?: string },
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
          where,
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
            opportunityId: activity.opportunityId ?? null,
            opportunityName: null,
          });
        }

        // Label each conversation with its opportunity name (for the person view).
        const opportunityIds = [
          ...new Set(
            conversations
              .map((conversation) => conversation.opportunityId)
              .filter((id): id is string => isDefined(id)),
          ),
        ];

        if (opportunityIds.length > 0) {
          const opportunityRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'opportunity',
              { shouldBypassPermissionChecks: true },
            );

          const opportunities = await opportunityRepository.find({
            where: { id: In(opportunityIds) },
          });

          const nameById = new Map<string, string>(
            opportunities.map((opportunity: any) => [
              opportunity.id,
              opportunity.name,
            ]),
          );

          for (const conversation of conversations) {
            if (isDefined(conversation.opportunityId)) {
              conversation.opportunityName =
                nameById.get(conversation.opportunityId) ?? null;
            }
          }
        }

        return conversations;
      },
      systemAuthContext,
    );
  }
}
