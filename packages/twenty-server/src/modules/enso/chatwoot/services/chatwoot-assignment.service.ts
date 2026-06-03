import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { ChatwootClientService } from 'src/modules/enso/chatwoot/services/chatwoot-client.service';

// On claim (deal leaves ROUTING with an owner), push that assignment INTO
// Chatwoot so the conversation lands in the manager's queue — keeping the CRM
// the single source of truth (Chatwoot auto-assignment stays OFF). Uses the
// Application API (account token, already live — no Platform-App gate).
//
// Best-effort: a missing conversation, an unmapped agent, or a Chatwoot outage
// must NEVER fail the claim. The CRM owner is authoritative regardless.
@Injectable()
export class ChatwootAssignmentService {
  private readonly logger = new Logger(ChatwootAssignmentService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly chatwootClient: ChatwootClientService,
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
      const target = await this.resolveAssignmentTarget(
        workspaceId,
        opportunityId,
      );

      if (!target) {
        return;
      }

      const agentId = await this.chatwootClient.findAgentIdByEmail(
        target.ownerEmail,
      );

      if (!isDefined(agentId)) {
        this.logger.warn(
          `No Chatwoot agent for ${target.ownerEmail} — conversation ${target.conversationId} left unassigned (provision agents to enable push).`,
        );

        return;
      }

      await this.chatwootClient.assignConversation(
        target.conversationId,
        agentId,
      );

      this.logger.log(
        `Assigned Chatwoot conversation ${target.conversationId} → ${target.ownerEmail} (deal ${opportunityId}).`,
      );
    } catch (error) {
      this.logger.error(
        `Chatwoot assignment push failed for deal ${opportunityId}: ${(error as Error).message}`,
      );
    }
  }

  // Returns the conversation to (re)assign and the owner's email, or null when
  // the deal isn't a claimed social deal we can act on.
  private async resolveAssignmentTarget(
    workspaceId: string,
    opportunityId: string,
  ): Promise<{ conversationId: string; ownerEmail: string } | null> {
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

        const activityRepository =
          await this.globalWorkspaceOrmManager.getRepository<any>(
            workspaceId,
            'inboundActivity',
            { shouldBypassPermissionChecks: true },
          );

        // A deal can hold several activities; take the most recent one that
        // actually carries a Chatwoot conversation id.
        const activities = await activityRepository.find({
          where: { opportunityId },
          order: { createdAt: 'DESC' },
        });

        const conversationId = activities.find((activity: any) =>
          isDefined(activity.chatwootConversationId),
        )?.chatwootConversationId;

        if (!isDefined(conversationId)) {
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

        const ownerEmail: string | undefined = owner?.userEmail;

        if (!isDefined(ownerEmail)) {
          return null;
        }

        return { conversationId: String(conversationId), ownerEmail };
      },
      systemAuthContext,
    );
  }
}
