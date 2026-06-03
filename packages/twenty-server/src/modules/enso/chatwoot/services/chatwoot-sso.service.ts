import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { ChatwootAgentProvisioningService } from 'src/modules/enso/chatwoot/services/chatwoot-agent-provisioning.service';
import { ChatwootClientService } from 'src/modules/enso/chatwoot/services/chatwoot-client.service';
import {
  type DealConversation,
  ChatwootConversationResolverService,
} from 'src/modules/enso/chatwoot/services/chatwoot-conversation-resolver.service';

export type ChatwootEmbedConversation = {
  conversationId: string;
  label: string;
  // Dashboard deep-link, loaded after the SSO session is established.
  url: string;
};

export type ChatwootSsoResult = {
  // 5-min single-use URL — establishes the session at the Chatwoot frontend.
  ssoUrl: string;
  // Every conversation on the deal (newest first); the embed renders a switcher
  // and deep-links to the selected one on the shared session.
  conversations: ChatwootEmbedConversation[];
};

// Mints an embedded-conversation session for the CURRENT manager: gather ALL of
// the opportunity's Chatwoot conversations → ensure the manager has a Chatwoot
// agent (JIT) → mint a single 5-min SSO login URL (D6). Returns null when the
// deal has no conversation. Throws when prerequisites are missing so the
// endpoint surfaces a meaningful error.
@Injectable()
export class ChatwootSsoService {
  constructor(
    private readonly chatwootClient: ChatwootClientService,
    private readonly provisioningService: ChatwootAgentProvisioningService,
    private readonly conversationResolver: ChatwootConversationResolverService,
  ) {}

  async mintForOpportunity(params: {
    workspaceId: string;
    opportunityId: string;
    userEmail: string;
    userName: string;
  }): Promise<ChatwootSsoResult | null> {
    if (!this.chatwootClient.isPlatformConfigured()) {
      throw new Error(
        'Chatwoot Platform API not configured (CHATWOOT_PLATFORM_TOKEN missing) — cannot mint SSO.',
      );
    }

    const conversations = await this.conversationResolver.listForOpportunity(
      params.workspaceId,
      params.opportunityId,
    );

    if (conversations.length === 0) {
      // No Chatwoot conversation on this deal — nothing to embed.
      return null;
    }

    const agentId = await this.provisioningService.ensureAgentForMember({
      email: params.userEmail,
      name: params.userName || params.userEmail,
    });

    if (!isDefined(agentId)) {
      throw new Error(
        `Could not resolve or provision a Chatwoot agent for ${params.userEmail}.`,
      );
    }

    const ssoUrl = await this.chatwootClient.mintSsoUrl(agentId);

    return {
      ssoUrl,
      conversations: conversations.map((conversation) => ({
        conversationId: conversation.conversationId,
        label: this.buildLabel(conversation),
        url: this.chatwootClient.conversationUrl(conversation.conversationId),
      })),
    };
  }

  // A short, human label for the switcher: "Instagram · 3 Jun" (channel + date),
  // falling back to the channel or the raw id.
  private buildLabel(conversation: DealConversation): string {
    const channel = isDefined(conversation.platform)
      ? conversation.platform.charAt(0).toUpperCase() +
        conversation.platform.slice(1).toLowerCase()
      : 'Chat';

    if (!isDefined(conversation.occurredAt)) {
      return channel;
    }

    const date = new Date(conversation.occurredAt);
    const stamp = `${date.getUTCDate()} ${date.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}`;

    return `${channel} · ${stamp}`;
  }
}
