import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { ChatwootClientService } from 'src/modules/enso/chatwoot/services/chatwoot-client.service';
import { ChatwootConversationResolverService } from 'src/modules/enso/chatwoot/services/chatwoot-conversation-resolver.service';
import { CLOSED_OPPORTUNITY_STAGES } from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';

// On claim (deal leaves ROUTING with an owner), push that assignment INTO
// Chatwoot for EVERY conversation on the deal — so all the threads land in the
// owner's queue, keeping the CRM the single source of truth (Chatwoot
// auto-assignment stays OFF). Uses the Application API (account token, already
// live — no Platform-App gate).
//
// Best-effort: a missing conversation, an unmapped agent, or a Chatwoot outage
// must NEVER fail the claim. The CRM owner is authoritative regardless.
@Injectable()
export class ChatwootAssignmentService {
  private readonly logger = new Logger(ChatwootAssignmentService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly chatwootClient: ChatwootClientService,
    private readonly conversationResolver: ChatwootConversationResolverService,
  ) {}

  async pushAssignmentOnClaim(
    authContext: WorkspaceAuthContext,
    opportunityId: string,
  ): Promise<void> {
    const workspaceId = authContext.workspace?.id;

    if (
      !workspaceId ||
      !isDefined(opportunityId) ||
      !this.chatwootClient.isConfigured()
    ) {
      return;
    }

    try {
      const ownerEmail = await this.resolveClaimedOwnerEmail(
        workspaceId,
        opportunityId,
      );

      if (!isDefined(ownerEmail)) {
        return;
      }

      const conversations = await this.conversationResolver.listForOpportunity(
        workspaceId,
        opportunityId,
      );

      if (conversations.length === 0) {
        return;
      }

      const agentId = await this.chatwootClient.findAgentIdByEmail(ownerEmail);

      if (!isDefined(agentId)) {
        this.logger.warn(
          `No Chatwoot agent for ${ownerEmail} — ${conversations.length} conversation(s) on deal ${opportunityId} left unassigned (provision agents to enable push).`,
        );

        return;
      }

      // Assign each conversation; one failure shouldn't skip the rest.
      const outcomes = await Promise.allSettled(
        conversations.map((conversation) =>
          this.chatwootClient.assignConversation(
            conversation.conversationId,
            agentId,
          ),
        ),
      );

      const assigned = outcomes.filter((o) => o.status === 'fulfilled').length;

      this.logger.log(
        `Assigned ${assigned}/${conversations.length} Chatwoot conversation(s) → ${ownerEmail} (deal ${opportunityId}).`,
      );
    } catch (error) {
      this.logger.error(
        `Chatwoot assignment push failed for deal ${opportunityId}: ${(error as Error).message}`,
      );
    }
  }

  // On deal close (CLOSED_WON / CLOSED_LOST), resolve every Chatwoot conversation
  // on the deal. Combined with the inbox "lock to single conversation = OFF"
  // setting, the contact's next message then opens a NEW conversation → a fresh
  // inboundActivity → a new opportunity (the closed one no longer dedups) — i.e.
  // re-engagement starts a clean session. Best-effort: never fails the close.
  async resolveConversationsOnClose(
    authContext: WorkspaceAuthContext,
    opportunityId: string,
  ): Promise<void> {
    const workspaceId = authContext.workspace?.id;

    if (
      !workspaceId ||
      !isDefined(opportunityId) ||
      !this.chatwootClient.isConfigured()
    ) {
      return;
    }

    try {
      const isClosed = await this.isClosedDeal(workspaceId, opportunityId);

      if (!isClosed) {
        return;
      }

      const conversations = await this.conversationResolver.listForOpportunity(
        workspaceId,
        opportunityId,
      );

      if (conversations.length === 0) {
        return;
      }

      // Resolving is idempotent (explicit status); one failure shouldn't skip the rest.
      const outcomes = await Promise.allSettled(
        conversations.map((conversation) =>
          this.chatwootClient.toggleStatus(
            conversation.conversationId,
            'resolved',
          ),
        ),
      );

      const resolved = outcomes.filter((o) => o.status === 'fulfilled').length;

      this.logger.log(
        `Resolved ${resolved}/${conversations.length} Chatwoot conversation(s) on closed deal ${opportunityId}.`,
      );
    } catch (error) {
      this.logger.error(
        `Chatwoot resolve-on-close failed for deal ${opportunityId}: ${(error as Error).message}`,
      );
    }
  }

  private async isClosedDeal(
    workspaceId: string,
    opportunityId: string,
  ): Promise<boolean> {
    const systemAuthContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const opportunityRepository =
          await this.globalWorkspaceOrmManager.getRepository<any>(
            workspaceId,
            'opportunity',
            { shouldBypassPermissionChecks: true },
          );

        const opportunity = await opportunityRepository.findOne({
          where: { id: opportunityId },
        });

        return (
          isDefined(opportunity?.stage) &&
          (CLOSED_OPPORTUNITY_STAGES as readonly string[]).includes(
            opportunity.stage,
          )
        );
      },
      systemAuthContext,
    );
  }

  // The owner's email, or null when the deal isn't a claimed deal we act on.
  private async resolveClaimedOwnerEmail(
    workspaceId: string,
    opportunityId: string,
  ): Promise<string | null> {
    const systemAuthContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const opportunityRepository =
          await this.globalWorkspaceOrmManager.getRepository<any>(
            workspaceId,
            'opportunity',
            { shouldBypassPermissionChecks: true },
          );

        const opportunity = await opportunityRepository.findOne({
          where: { id: opportunityId },
        });

        // Only claimed deals (left ROUTING) with an owner.
        if (
          !opportunity ||
          opportunity.stage === 'ROUTING' ||
          !isDefined(opportunity.ownerId)
        ) {
          return null;
        }

        const workspaceMemberRepository =
          await this.globalWorkspaceOrmManager.getRepository<any>(
            workspaceId,
            'workspaceMember',
            { shouldBypassPermissionChecks: true },
          );

        const owner = await workspaceMemberRepository.findOne({
          where: { id: opportunity.ownerId },
        });

        return owner?.userEmail ?? null;
      },
      systemAuthContext,
    );
  }
}
