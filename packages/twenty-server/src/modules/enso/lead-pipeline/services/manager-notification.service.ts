import { Injectable, Logger } from '@nestjs/common';

import axios from 'axios';
import { isDefined } from 'twenty-shared/utils';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

// Manager notification via Google Chat webhook (in-app / Knock comes later).
// Webhook URLs are read from env (best-effort: a missing webhook or a failed
// post must never fail routing). Two channels:
//   ENSO_ROUTING_CHAT_WEBHOOK_URL — per-assignment "you have N minutes" notices
//   ENSO_OPS_CHAT_WEBHOOK_URL      — escalation / no-candidate alerts (falls
//                                    back to the routing webhook if unset)
@Injectable()
export class ManagerNotificationService {
  private readonly logger = new Logger(ManagerNotificationService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  private get routingWebhookUrl(): string | undefined {
    return process.env.ENSO_ROUTING_CHAT_WEBHOOK_URL || undefined;
  }

  private get opsWebhookUrl(): string | undefined {
    return (
      process.env.ENSO_OPS_CHAT_WEBHOOK_URL ||
      process.env.ENSO_ROUTING_CHAT_WEBHOOK_URL ||
      undefined
    );
  }

  private recordUrl(workspaceId: string, opportunityId: string): string {
    const base = (
      process.env.ENSO_CRM_APP_URL ||
      process.env.FRONTEND_URL ||
      ''
    ).replace(/\/$/, '');

    return base
      ? `${base}/object/opportunity/${opportunityId}`
      : `opportunity ${opportunityId}`;
  }

  // Post the "claim within N minutes" notice for a freshly-assigned deal.
  async notifyAssignment(
    authContext: WorkspaceAuthContext,
    params: {
      opportunityId: string;
      managerId: string;
      autoClaimed: boolean;
      claimWindowMinutes: number;
    },
  ): Promise<void> {
    const webhookUrl = this.routingWebhookUrl;
    const workspaceId = authContext.workspace?.id;

    if (!isDefined(webhookUrl) || !isDefined(workspaceId)) {
      this.logger.warn(
        'No routing webhook configured — skipping notification.',
      );

      return;
    }

    const details = await this.loadDealDetails(
      workspaceId,
      params.opportunityId,
      params.managerId,
    );

    const headline = params.autoClaimed
      ? `🔔 *New lead assigned to you* — your returning client`
      : `🔔 *New lead routed* — claim within ${params.claimWindowMinutes} min`;

    const lines = [
      headline,
      details.managerName ? `Manager: ${details.managerName}` : undefined,
      details.projectName ? `Project: ${details.projectName}` : undefined,
      details.who ? `Contact: ${details.who}` : undefined,
      details.m2 ? `Area: ${details.m2} m²` : undefined,
      details.source ? `Source: ${details.source}` : undefined,
      this.recordUrl(workspaceId, params.opportunityId),
    ].filter(Boolean);

    await this.post(webhookUrl, lines.join('\n'));
  }

  // Ops alert when an opportunity can't be routed (no candidates / max attempts).
  async notifyEscalation(
    authContext: WorkspaceAuthContext,
    params: { opportunityId: string; reason: string; attempts?: number },
  ): Promise<void> {
    const webhookUrl = this.opsWebhookUrl;
    const workspaceId = authContext.workspace?.id;

    if (!isDefined(webhookUrl) || !isDefined(workspaceId)) {
      this.logger.warn(`Escalation (no webhook): ${params.reason}`);

      return;
    }

    const lines = [
      `⚠️ *Routing escalation* — ${params.reason}`,
      isDefined(params.attempts) ? `Attempts: ${params.attempts}` : undefined,
      this.recordUrl(workspaceId, params.opportunityId),
    ].filter(Boolean);

    await this.post(webhookUrl, lines.join('\n'));
  }

  private async loadDealDetails(
    workspaceId: string,
    opportunityId: string,
    managerId: string,
  ): Promise<{
    managerName?: string;
    projectName?: string;
    who?: string;
    m2?: number;
    source?: string;
  }> {
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

        const workspaceMemberRepository =
          await this.globalWorkspaceOrmManager.getRepository<any>(
            workspaceId,
            'workspaceMember',
            { shouldBypassPermissionChecks: true },
          );

        const manager = await workspaceMemberRepository.findOne({
          where: { id: managerId },
        });

        const managerName = manager
          ? `${manager.name?.firstName ?? ''} ${manager.name?.lastName ?? ''}`.trim()
          : undefined;

        let projectName: string | undefined;

        if (isDefined(opportunity?.projectId)) {
          const projectRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'project',
              { shouldBypassPermissionChecks: true },
            );

          const project = await projectRepository.findOne({
            where: { id: opportunity.projectId },
          });

          projectName = project?.name ?? undefined;
        }

        let who: string | undefined;

        if (isDefined(opportunity?.pointOfContactId)) {
          const personRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'person',
              { shouldBypassPermissionChecks: true },
            );

          const person = await personRepository.findOne({
            where: { id: opportunity.pointOfContactId },
          });

          const fullName =
            `${person?.name?.firstName ?? ''} ${person?.name?.lastName ?? ''}`.trim();

          who = person?.phones?.primaryPhoneNumber ?? (fullName || undefined);
        }

        return {
          managerName: managerName || undefined,
          projectName,
          who,
          m2: opportunity?.m2Min ?? undefined,
          source: opportunity?.source ?? undefined,
        };
      },
      systemAuthContext,
    );
  }

  private async post(webhookUrl: string, text: string): Promise<void> {
    try {
      await axios.post(
        webhookUrl,
        { text },
        { headers: { 'Content-Type': 'application/json' }, timeout: 10_000 },
      );
    } catch (error) {
      // Notification is best-effort — never fail routing because Chat is down.
      this.logger.error(
        `Google Chat notification failed: ${(error as Error).message}`,
      );
    }
  }
}
