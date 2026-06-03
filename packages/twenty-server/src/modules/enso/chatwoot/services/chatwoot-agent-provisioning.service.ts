import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { ChatwootClientService } from 'src/modules/enso/chatwoot/services/chatwoot-client.service';

// Maps CRM managers → Chatwoot agents BY EMAIL (D10) — no separate mapping
// table. Idempotent: looks the agent up by email first (Application API) and
// only creates via the Platform API when absent, then adds account membership
// (mandatory or the SSO'd dashboard hangs) and inbox membership (so the agent
// can see assigned conversations across all brand inboxes).
//
// Creation needs the Platform-App token (CHATWOOT_PLATFORM_TOKEN); the lookup
// alone works with the account token.
@Injectable()
export class ChatwootAgentProvisioningService {
  private readonly logger = new Logger(ChatwootAgentProvisioningService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly chatwootClient: ChatwootClientService,
  ) {}

  // Returns the Chatwoot user/agent id for this member, creating + enrolling it
  // on first call. Used JIT by the SSO endpoint and in bulk by provisionAll.
  async ensureAgentForMember(params: {
    email: string;
    name: string;
  }): Promise<number | undefined> {
    if (!this.chatwootClient.isConfigured()) {
      return undefined;
    }

    const existing = await this.chatwootClient.findAgentIdByEmail(params.email);

    if (isDefined(existing)) {
      return existing;
    }

    if (!this.chatwootClient.isPlatformConfigured()) {
      this.logger.warn(
        `No Chatwoot agent for ${params.email} and Platform API not configured — cannot provision.`,
      );

      return undefined;
    }

    const user = await this.chatwootClient.createUser({
      email: params.email,
      name: params.name,
    });

    await this.chatwootClient.addAccountUser(user.id, 'agent');

    // Best-effort inbox enrolment — assignment/visibility still works via the
    // account, but inbox membership keeps the agent's conversation list intact.
    try {
      const inboxIds = await this.chatwootClient.listInboxIds();

      await Promise.all(
        inboxIds.map((inboxId) =>
          this.chatwootClient.addInboxMember(inboxId, user.id),
        ),
      );
    } catch (error) {
      this.logger.warn(
        `Agent ${params.email} created but inbox enrolment failed: ${(error as Error).message}`,
      );
    }

    this.logger.log(
      `Provisioned Chatwoot agent ${params.email} (#${user.id}).`,
    );

    return user.id;
  }

  // Bulk: provision every routing-eligible workspace member. Returns a per-email
  // outcome so the admin endpoint can report what happened.
  async provisionRoutingMembers(
    workspaceId: string,
  ): Promise<Array<{ email: string; agentId?: number; status: string }>> {
    const systemAuthContext = buildSystemAuthContext(workspaceId);

    const members =
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const workspaceMemberRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'workspaceMember',
              { shouldBypassPermissionChecks: true },
            );

          const rows = await workspaceMemberRepository.find({
            where: { isAvailableForRouting: true },
          });

          return rows.map((row: any) => ({
            email: row.userEmail as string | undefined,
            name: `${row.name?.firstName ?? ''} ${row.name?.lastName ?? ''}`.trim(),
          }));
        },
        systemAuthContext,
      );

    const results: Array<{ email: string; agentId?: number; status: string }> =
      [];

    for (const member of members) {
      if (!isDefined(member.email)) {
        continue;
      }

      try {
        const agentId = await this.ensureAgentForMember({
          email: member.email,
          name: member.name || member.email,
        });

        results.push({
          email: member.email,
          agentId,
          status: isDefined(agentId) ? 'ok' : 'skipped',
        });
      } catch (error) {
        results.push({
          email: member.email,
          status: `error: ${(error as Error).message}`,
        });
      }
    }

    return results;
  }
}
