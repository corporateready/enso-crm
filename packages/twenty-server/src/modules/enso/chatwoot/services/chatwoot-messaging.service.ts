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

export type ChatwootRecordType = 'opportunity' | 'person';

export type DealConversationSummary = {
  conversationId: string;
  // Clean channel label, e.g. "Instagram".
  channel: string | null;
  // Chatwoot conversation status: open | resolved | pending | snoozed.
  status: string | null;
  contactName: string | null;
  personName: string | null;
  opportunityId: string | null;
  opportunityName: string | null;
  projectName: string | null;
  createdAt: string | null;
  lastActivityAt: number | null;
};

// "INSTAGRAM" / "Channel::FacebookPage" → "Instagram" / "Facebook".
const cleanChannel = (
  platform: string | null,
  metaChannel: string | null,
): string | null => {
  const raw = platform ?? metaChannel?.replace(/^Channel::/, '') ?? null;

  if (!raw) {
    return null;
  }

  const lower = raw.toLowerCase();

  if (lower.includes('insta')) return 'Instagram';
  if (lower.includes('face') || lower.includes('messenger')) return 'Facebook';
  if (lower.includes('whats')) return 'WhatsApp';
  if (lower.includes('tele')) return 'Telegram';

  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
};

// Read/reply for the native in-CRM chat panel, record-agnostic: works from an
// opportunity (that deal's conversations) or a person (all their conversations
// across deals, each labelled with its opportunity). Every conversation-scoped
// method enforces the conversation belongs to the record, then proxies Chatwoot
// with the account token (token never reaches the browser).
@Injectable()
export class ChatwootMessagingService {
  constructor(
    private readonly chatwootClient: ChatwootClientService,
    private readonly conversationResolver: ChatwootConversationResolverService,
    private readonly provisioningService: ChatwootAgentProvisioningService,
  ) {}

  async listConversations(
    workspaceId: string,
    recordType: ChatwootRecordType,
    recordId: string,
  ): Promise<DealConversationSummary[]> {
    if (!this.chatwootClient.isConfigured()) {
      return [];
    }

    const conversations = await this.conversationResolver.listForRecord(
      workspaceId,
      recordType,
      recordId,
    );

    const summaries = await Promise.all(
      conversations.map(async (conversation) => {
        let contactName: string | null = null;
        let metaChannel: string | null = null;
        let status: string | null = null;
        let createdAt: string | null = conversation.createdAt;
        let lastActivityAt: number | null = conversation.createdAt
          ? Date.parse(conversation.createdAt)
          : null;

        try {
          const meta = await this.chatwootClient.getConversationMeta(
            conversation.conversationId,
          );

          contactName = meta.contactName;
          metaChannel = meta.channelType;
          status = meta.status;
          if (isDefined(meta.createdAt)) {
            createdAt = new Date(meta.createdAt).toISOString();
          }
          lastActivityAt = meta.lastActivityAt ?? lastActivityAt;
        } catch {
          // Chatwoot hiccup on one conversation shouldn't drop the whole list.
        }

        return {
          conversationId: conversation.conversationId,
          channel: cleanChannel(conversation.platform, metaChannel),
          status,
          contactName,
          personName: conversation.personName,
          opportunityId: conversation.opportunityId,
          opportunityName: conversation.opportunityName,
          projectName: conversation.projectName,
          createdAt,
          lastActivityAt,
        };
      }),
    );

    return summaries.sort(
      (a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0),
    );
  }

  async listMessages(
    workspaceId: string,
    recordType: ChatwootRecordType,
    recordId: string,
    conversationId: string,
  ): Promise<ChatwootMessage[]> {
    await this.assertConversationOnRecord(
      workspaceId,
      recordType,
      recordId,
      conversationId,
    );

    return this.chatwootClient.listMessages(conversationId);
  }

  async sendReply(params: {
    workspaceId: string;
    recordType: ChatwootRecordType;
    recordId: string;
    conversationId: string;
    content?: string;
    attachments?: ChatwootUploadFile[];
    userEmail: string;
    userName: string;
  }): Promise<ChatwootMessage> {
    await this.assertConversationOnRecord(
      params.workspaceId,
      params.recordType,
      params.recordId,
      params.conversationId,
    );

    const asToken = await this.resolveAgentToken(
      params.userEmail,
      params.userName,
    );

    return this.chatwootClient.sendMessage(params.conversationId, {
      content: params.content,
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

  async fetchAttachment(params: {
    workspaceId: string;
    recordType: ChatwootRecordType;
    recordId: string;
    conversationId: string;
    url: string;
  }): Promise<{ data: Buffer; contentType: string }> {
    await this.assertConversationOnRecord(
      params.workspaceId,
      params.recordType,
      params.recordId,
      params.conversationId,
    );

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

  // The conversation must belong to the record (deal or person) — prevents
  // reading/replying to arbitrary conversations by id.
  private async assertConversationOnRecord(
    workspaceId: string,
    recordType: ChatwootRecordType,
    recordId: string,
    conversationId: string,
  ): Promise<void> {
    const conversations = await this.conversationResolver.listForRecord(
      workspaceId,
      recordType,
      recordId,
    );

    const belongs = conversations.some(
      (conversation) => conversation.conversationId === String(conversationId),
    );

    if (!belongs) {
      throw new ForbiddenException(
        'Conversation does not belong to this record.',
      );
    }
  }
}
