import { ForbiddenException, Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import {
  type ChatwootCannedResponse,
  type ChatwootMessage,
  type ChatwootUploadFile,
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
  assigneeName: string | null;
  lastActivityAt: number | null;
};

// Read/reply/manage for the native in-CRM chat panel. Every conversation-scoped
// method enforces that the conversation belongs to the opportunity, then proxies
// Chatwoot's API with the account token (token never reaches the browser).
@Injectable()
export class ChatwootMessagingService {
  constructor(
    private readonly chatwootClient: ChatwootClientService,
    private readonly conversationResolver: ChatwootConversationResolverService,
    private readonly provisioningService: ChatwootAgentProvisioningService,
  ) {}

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
            assigneeName: meta.assigneeName,
            lastActivityAt: meta.lastActivityAt,
          };
        } catch {
          return {
            conversationId: conversation.conversationId,
            label: conversation.platform ?? `#${conversation.conversationId}`,
            contactName: null,
            channelType: conversation.platform,
            status: null,
            assigneeName: null,
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
    content?: string;
    isPrivate?: boolean;
    attachments?: ChatwootUploadFile[];
    userEmail: string;
    userName: string;
  }): Promise<ChatwootMessage> {
    await this.assertConversationOnDeal(
      params.workspaceId,
      params.opportunityId,
      params.conversationId,
    );

    const asToken = await this.resolveAgentToken(
      params.userEmail,
      params.userName,
    );

    return this.chatwootClient.sendMessage(params.conversationId, {
      content: params.content,
      isPrivate: params.isPrivate,
      attachments: params.attachments,
      asToken,
    });
  }

  async listCannedResponses(): Promise<ChatwootCannedResponse[]> {
    if (!this.chatwootClient.isConfigured()) {
      return [];
    }

    return this.chatwootClient.listCannedResponses();
  }

  // Stream an attachment after verifying its conversation belongs to the deal.
  async fetchAttachment(params: {
    workspaceId: string;
    opportunityId: string;
    conversationId: string;
    url: string;
  }): Promise<{ data: Buffer; contentType: string }> {
    await this.assertConversationOnDeal(
      params.workspaceId,
      params.opportunityId,
      params.conversationId,
    );

    // Only proxy URLs on our Chatwoot host (no SSRF to arbitrary hosts).
    const base = this.chatwootClient.baseUrl ?? '';

    if (base === '' || !params.url.startsWith(base)) {
      throw new ForbiddenException('Attachment URL not allowed.');
    }

    return this.chatwootClient.fetchAttachment(params.url);
  }

  private async resolveAgentToken(
    email: string,
    name: string,
  ): Promise<string | undefined> {
    const agentId = await this.provisioningService.ensureAgentForMember({
      email,
      name: name || email,
    });

    return isDefined(agentId)
      ? this.chatwootClient.getUserAccessToken(agentId)
      : undefined;
  }

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
