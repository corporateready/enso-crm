import { ForbiddenException, Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import {
  type ChatwootMessage,
  ChatwootClientService,
} from 'src/modules/enso/chatwoot/services/chatwoot-client.service';
import { ChatwootAgentProvisioningService } from 'src/modules/enso/chatwoot/services/chatwoot-agent-provisioning.service';
import { ChatwootConversationResolverService } from 'src/modules/enso/chatwoot/services/chatwoot-conversation-resolver.service';

export type DealConversationSummary = {
  conversationId: string;
  label: string;
  contactName: string | null;
  channelType: string | null;
  status: string | null;
  lastActivityAt: number | null;
};

// Read/reply for the native in-CRM chat panel. Every method enforces that the
// conversation actually belongs to the opportunity (a manager can only read/
// reply to chats on a deal they opened), then proxies Chatwoot's API with the
// account token (token never reaches the browser). Replies are attributed to the
// calling manager via their own agent token when available.
@Injectable()
export class ChatwootMessagingService {
  constructor(
    private readonly chatwootClient: ChatwootClientService,
    private readonly conversationResolver: ChatwootConversationResolverService,
    private readonly provisioningService: ChatwootAgentProvisioningService,
  ) {}

  // The deal's conversations, newest activity first, with header metadata.
  async listConversations(
    workspaceId: string,
    opportunityId: string,
  ): Promise<DealConversationSummary[]> {
    if (!this.chatwootClient.isConfigured()) {
      return [];
    }

    const conversations = await this.conversationResolver.listForOpportunity(
      workspaceId,
      opportunityId,
    );

    const summaries = await Promise.all(
      conversations.map(async (conversation) => {
        try {
          const meta = await this.chatwootClient.getConversationMeta(
            conversation.conversationId,
          );

          return {
            conversationId: conversation.conversationId,
            label:
              meta.contactName ??
              meta.channelType ??
              `#${conversation.conversationId}`,
            contactName: meta.contactName,
            channelType: meta.channelType ?? conversation.platform,
            status: meta.status,
            lastActivityAt: meta.lastActivityAt,
          };
        } catch {
          // Chatwoot hiccup on one conversation shouldn't drop the whole list.
          return {
            conversationId: conversation.conversationId,
            label: conversation.platform ?? `#${conversation.conversationId}`,
            contactName: null,
            channelType: conversation.platform,
            status: null,
            lastActivityAt: conversation.occurredAt
              ? Date.parse(conversation.occurredAt)
              : null,
          };
        }
      }),
    );

    return summaries.sort(
      (a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0),
    );
  }

  async listMessages(
    workspaceId: string,
    opportunityId: string,
    conversationId: string,
  ): Promise<ChatwootMessage[]> {
    await this.assertConversationOnDeal(
      workspaceId,
      opportunityId,
      conversationId,
    );

    return this.chatwootClient.listMessages(conversationId);
  }

  async sendReply(params: {
    workspaceId: string;
    opportunityId: string;
    conversationId: string;
    content: string;
    userEmail: string;
    userName: string;
  }): Promise<ChatwootMessage> {
    await this.assertConversationOnDeal(
      params.workspaceId,
      params.opportunityId,
      params.conversationId,
    );

    // Attribute the reply to the calling manager when we can resolve their agent
    // token; otherwise fall back to the account token.
    let agentToken: string | undefined;
    const agentId = await this.provisioningService.ensureAgentForMember({
      email: params.userEmail,
      name: params.userName || params.userEmail,
    });

    if (isDefined(agentId)) {
      agentToken = await this.chatwootClient.getUserAccessToken(agentId);
    }

    return this.chatwootClient.sendMessage(
      params.conversationId,
      params.content,
      agentToken,
    );
  }

  // Guard: the conversation must be one of the deal's (prevents reading/replying
  // to arbitrary conversations by id).
  private async assertConversationOnDeal(
    workspaceId: string,
    opportunityId: string,
    conversationId: string,
  ): Promise<void> {
    const conversations = await this.conversationResolver.listForOpportunity(
      workspaceId,
      opportunityId,
    );

    const belongs = conversations.some(
      (conversation) => conversation.conversationId === String(conversationId),
    );

    if (!belongs) {
      throw new ForbiddenException(
        'Conversation does not belong to this opportunity.',
      );
    }
  }
}
