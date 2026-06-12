import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { GoogleChatWebhookService } from 'src/modules/enso/notifications/services/google-chat-webhook.service';

// Manager notification via Google Chat.
//
// Per-manager events (assignment, re-engagement) go to the assigned manager's
// PERSONAL webhook (their private space, set in Settings → Notifications) so the
// shared space isn't flooded. If a manager hasn't configured one yet we fall
// back to the shared routing webhook so nothing is silently dropped.
//   ENSO_ROUTING_CHAT_WEBHOOK_URL — fallback for per-manager events
//   ENSO_OPS_CHAT_WEBHOOK_URL      — escalation / no-candidate alerts (ops space;
//                                    falls back to the routing webhook if unset)
// All posts are best-effort: a missing/failed webhook must never fail routing.
@Injectable()
export class ManagerNotificationService {
  private readonly logger = new Logger(ManagerNotificationService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly googleChatWebhookService: GoogleChatWebhookService,
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

  private recordUrl(opportunityId: string): string | undefined {
    const base = (
      process.env.ENSO_CRM_APP_URL ||
      process.env.FRONTEND_URL ||
      ''
    ).replace(/\/$/, '');

    return base ? `${base}/object/opportunity/${opportunityId}` : undefined;
  }

  // The assigned manager's personal space, falling back to the shared routing
  // webhook for managers who haven't set one up yet.
  private async resolveManagerWebhookUrl(
    workspaceId: string,
    managerUserId: string | undefined,
  ): Promise<string | undefined> {
    if (isDefined(managerUserId)) {
      const personalWebhookUrl =
        await this.googleChatWebhookService.getWebhookUrl({
          userId: managerUserId,
          workspaceId,
        });

      if (isDefined(personalWebhookUrl)) {
        return personalWebhookUrl;
      }
    }

    return this.routingWebhookUrl;
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
    const workspaceId = authContext.workspace?.id;

    if (!isDefined(workspaceId)) {
      return;
    }

    const details = await this.loadDealDetails(
      workspaceId,
      params.opportunityId,
      params.managerId,
    );

    const webhookUrl = await this.resolveManagerWebhookUrl(
      workspaceId,
      details.managerUserId,
    );

    if (!isDefined(webhookUrl)) {
      this.logger.warn('No webhook configured — skipping assignment notice.');

      return;
    }

    const rows = [
      details.projectName
        ? { icon: 'DESCRIPTION', label: 'Project', text: details.projectName }
        : undefined,
      details.who
        ? { icon: 'PERSON', label: 'Contact', text: details.who }
        : undefined,
      isDefined(details.m2)
        ? { icon: 'MAP_PIN', label: 'Area', text: `${details.m2} m²` }
        : undefined,
      details.source
        ? { icon: 'STAR', label: 'Source', text: details.source }
        : undefined,
      params.autoClaimed
        ? undefined
        : {
            icon: 'CLOCK',
            label: 'Claim window',
            text: `${params.claimWindowMinutes} min — unclaimed leads reroute to the next manager`,
          },
    ].filter(isDefined);

    await this.googleChatWebhookService.post(
      webhookUrl,
      this.buildDealCard({
        title: params.autoClaimed
          ? '🔔 New lead assigned to you — your returning client'
          : `🎯 New lead routed — claim within ${params.claimWindowMinutes} min`,
        subtitle: 'ENSO CRM · Routing',
        rows,
        recordUrl: this.recordUrl(params.opportunityId),
        buttonText: params.autoClaimed ? 'Open in CRM' : 'Open to claim',
      }),
    );
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

    const recordUrl = this.recordUrl(params.opportunityId);

    const lines = [
      `⚠️ *Routing escalation* — ${params.reason}`,
      isDefined(params.attempts) ? `Attempts: ${params.attempts}` : undefined,
      recordUrl,
    ].filter(isDefined);

    await this.googleChatWebhookService.post(webhookUrl, {
      text: lines.join('\n'),
    });
  }

  // Ping the current owner when a claimed deal's contact re-engages (a new
  // inbound activity attached to the open deal).
  async notifyReengagement(
    authContext: WorkspaceAuthContext,
    params: { opportunityId: string; managerId: string },
  ): Promise<void> {
    const workspaceId = authContext.workspace?.id;

    if (!isDefined(workspaceId)) {
      return;
    }

    const details = await this.loadDealDetails(
      workspaceId,
      params.opportunityId,
      params.managerId,
    );

    const webhookUrl = await this.resolveManagerWebhookUrl(
      workspaceId,
      details.managerUserId,
    );

    if (!isDefined(webhookUrl)) {
      this.logger.warn(
        'No webhook configured — skipping re-engagement notice.',
      );

      return;
    }

    const rows = [
      details.projectName
        ? { icon: 'DESCRIPTION', label: 'Project', text: details.projectName }
        : undefined,
      details.who
        ? { icon: 'PERSON', label: 'Contact', text: details.who }
        : undefined,
      details.source
        ? { icon: 'STAR', label: 'Source', text: details.source }
        : undefined,
    ].filter(isDefined);

    await this.googleChatWebhookService.post(
      webhookUrl,
      this.buildDealCard({
        title: '🔁 Lead re-engaged — your client messaged again',
        subtitle: 'ENSO CRM · Inbound',
        rows,
        recordUrl: this.recordUrl(params.opportunityId),
        buttonText: 'Open conversation',
      }),
    );
  }

  // Build a Google Chat card for a deal: a row per detail + an Open button when
  // a record URL is available.
  private buildDealCard(params: {
    title: string;
    subtitle: string;
    rows: Array<{ icon: string; label: string; text: string }>;
    recordUrl: string | undefined;
    buttonText: string;
  }): Record<string, unknown> {
    const widgets: Record<string, unknown>[] = params.rows.map((row) => ({
      decoratedText: {
        startIcon: { knownIcon: row.icon },
        topLabel: row.label,
        text: row.text,
      },
    }));

    if (isDefined(params.recordUrl)) {
      widgets.push({
        buttonList: {
          buttons: [
            {
              text: params.buttonText,
              onClick: { openLink: { url: params.recordUrl } },
            },
          ],
        },
      });
    }

    return {
      cardsV2: [
        {
          cardId: 'enso-deal',
          card: {
            header: { title: params.title, subtitle: params.subtitle },
            sections: [{ widgets }],
          },
        },
      ],
    };
  }

  private async loadDealDetails(
    workspaceId: string,
    opportunityId: string,
    managerId: string,
  ): Promise<{
    managerName?: string;
    managerUserId?: string;
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
          managerUserId: manager?.userId ?? undefined,
          projectName,
          who,
          m2: opportunity?.m2Min ?? undefined,
          source: opportunity?.source ?? undefined,
        };
      },
      systemAuthContext,
    );
  }
}
