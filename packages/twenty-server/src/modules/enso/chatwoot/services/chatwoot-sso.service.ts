import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { ChatwootAgentProvisioningService } from 'src/modules/enso/chatwoot/services/chatwoot-agent-provisioning.service';
import { ChatwootClientService } from 'src/modules/enso/chatwoot/services/chatwoot-client.service';

export type ChatwootSsoResult = {
  // 5-min single-use URL — establishes the session at the Chatwoot frontend.
  ssoUrl: string;
  // Where to navigate the iframe AFTER the session is established.
  conversationUrl: string;
  conversationId: string;
};

// Mints an embedded-conversation session for the CURRENT manager: resolve the
// opportunity's Chatwoot conversation → ensure the manager has a Chatwoot agent
// (JIT) → mint a fresh 5-min SSO login URL. Two-step by design (D6): the SSO URL
// logs in, then the iframe deep-links to the conversation on the same-site
// cookie. Throws when prerequisites are missing so the endpoint returns a
// meaningful error.
@Injectable()
export class ChatwootSsoService {
  private readonly logger = new Logger(ChatwootSsoService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly chatwootClient: ChatwootClientService,
    private readonly provisioningService: ChatwootAgentProvisioningService,
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

    const conversationId = await this.findConversationId(
      params.workspaceId,
      params.opportunityId,
    );

    if (!isDefined(conversationId)) {
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
      conversationUrl: this.chatwootClient.conversationUrl(conversationId),
      conversationId,
    };
  }

  private async findConversationId(
    workspaceId: string,
    opportunityId: string,
  ): Promise<string | undefined> {
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
          order: { createdAt: 'DESC' },
        });

        const conversationId = activities.find((activity: any) =>
          isDefined(activity.chatwootConversationId),
        )?.chatwootConversationId;

        return isDefined(conversationId) ? String(conversationId) : undefined;
      },
      systemAuthContext,
    );
  }
}
