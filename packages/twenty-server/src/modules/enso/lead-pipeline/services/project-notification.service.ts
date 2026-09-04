import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { OPPORTUNITY_SOURCE_LABEL } from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';
import { ProjectChatWebhookService } from 'src/modules/enso/notifications/services/project-chat-webhook.service';

type MarketingDealCard = {
  dealName?: string;
  projectName?: string;
  source?: string;
  who?: string;
  phone?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  trafficType?: string;
  landingPage?: string;
};

// The MARKETING lane: one shared Google Chat space per development, posting
// every new deal with the attribution that opened it.
//
// Read by the marketing team, not by managers — so the card answers "which
// spend produced this?" (source / campaign / placement / traffic type) rather
// than "claim this now". The per-manager private cards in
// ManagerNotificationService are unaffected and still fire; a new deal
// legitimately produces one post in each lane.
//
// Posts only on deal CREATION. A re-engagement on an existing deal is not new
// demand, so counting it here would inflate whatever marketing measures from
// this feed.
@Injectable()
export class ProjectNotificationService {
  private readonly logger = new Logger(ProjectNotificationService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly projectChatWebhookService: ProjectChatWebhookService,
  ) {}

  private recordUrl(recordId: string): string | undefined {
    const base = (
      process.env.ENSO_CRM_APP_URL ||
      process.env.FRONTEND_URL ||
      ''
    ).replace(/\/$/, '');

    return base ? `${base}/object/opportunity/${recordId}` : undefined;
  }

  async notifyNewDeal(
    authContext: WorkspaceAuthContext,
    params: { opportunityId: string },
  ): Promise<void> {
    const workspaceId = authContext.workspace?.id;

    if (!isDefined(workspaceId)) {
      return;
    }

    const loaded = await this.loadCard(workspaceId, params.opportunityId);

    if (!isDefined(loaded)) {
      return;
    }

    const { projectId, card } = loaded;

    // A deal with no project has no room to post to. Not an error: unattributed
    // inbound exists, and the manager lane still covers it.
    if (!isDefined(projectId)) {
      return;
    }

    const webhookUrl = await this.projectChatWebhookService.getWebhookUrl({
      projectId,
      workspaceId,
    });

    if (!isDefined(webhookUrl)) {
      return;
    }

    const posted = await this.projectChatWebhookService.post(
      webhookUrl,
      this.buildCard(card, this.recordUrl(params.opportunityId)),
    );

    if (posted) {
      this.logger.log(
        `Posted new deal ${params.opportunityId} to the ${card.projectName ?? projectId} marketing space.`,
      );
    }
  }

  private buildCard(
    card: MarketingDealCard,
    recordUrl: string | undefined,
  ): Record<string, unknown> {
    const sourceLabel = isDefined(card.source)
      ? (OPPORTUNITY_SOURCE_LABEL[card.source] ?? card.source)
      : 'Lead';

    const rows = [
      isDefined(card.projectName)
        ? { icon: 'STORE', label: 'Project', text: card.projectName }
        : undefined,
      isDefined(card.who)
        ? { icon: 'PERSON', label: 'Contact', text: card.who }
        : undefined,
      isDefined(card.phone)
        ? { icon: 'PHONE', label: 'Phone', text: card.phone }
        : undefined,
      isDefined(card.utmSource)
        ? { icon: 'BOOKMARK', label: 'Source', text: card.utmSource }
        : undefined,
      isDefined(card.utmCampaign)
        ? { icon: 'OFFER', label: 'Campaign', text: card.utmCampaign }
        : undefined,
      isDefined(card.utmContent)
        ? { icon: 'TICKET', label: 'Placement', text: card.utmContent }
        : undefined,
      isDefined(card.utmTerm)
        ? { icon: 'TICKET', label: 'Term', text: card.utmTerm }
        : undefined,
      isDefined(card.utmMedium)
        ? { icon: 'DESCRIPTION', label: 'Medium', text: card.utmMedium }
        : undefined,
      isDefined(card.trafficType)
        ? { icon: 'MULTIPLE_PEOPLE', label: 'Traffic', text: card.trafficType }
        : undefined,
      isDefined(card.landingPage)
        ? { icon: 'MAP_PIN', label: 'Landing page', text: card.landingPage }
        : undefined,
    ].filter(isDefined);

    // Says so explicitly when nothing came through, because a blank attribution
    // block is exactly the thing marketing needs to see and chase.
    if (
      !isDefined(card.utmSource) &&
      !isDefined(card.utmCampaign) &&
      !isDefined(card.utmMedium)
    ) {
      rows.push({
        icon: 'DESCRIPTION',
        label: 'Attribution',
        text: 'none — this lead arrived untagged',
      });
    }

    const widgets: Record<string, unknown>[] = rows.map((row) => ({
      decoratedText: {
        startIcon: { knownIcon: row.icon },
        topLabel: row.label,
        text: row.text,
      },
    }));

    if (isDefined(recordUrl)) {
      widgets.push({
        buttonList: {
          buttons: [
            {
              text: 'Open in CRM',
              onClick: { openLink: { url: recordUrl } },
            },
          ],
        },
      });
    }

    return {
      cardsV2: [
        {
          cardId: 'enso-project-deal',
          card: {
            header: {
              title: `🎯 New deal — ${sourceLabel}`,
              subtitle: card.dealName ?? 'New deal',
            },
            sections: [{ widgets }],
          },
        },
      ],
    };
  }

  private async loadCard(
    workspaceId: string,
    opportunityId: string,
  ): Promise<
    { projectId: string | undefined; card: MarketingDealCard } | undefined
  > {
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

        if (!isDefined(opportunity)) {
          return undefined;
        }

        let projectName: string | undefined;

        if (isDefined(opportunity.projectId)) {
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
        let phone: string | undefined;

        if (isDefined(opportunity.pointOfContactId)) {
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

          who = fullName || undefined;
          phone = person?.phones?.primaryPhoneNumber ?? undefined;
        }

        return {
          projectId: opportunity.projectId ?? undefined,
          card: {
            dealName: opportunity.name ?? undefined,
            projectName,
            source: opportunity.source ?? undefined,
            who,
            phone,
            // The FROZEN first-touch snapshot, which is the point: marketing
            // wants the touch that opened the deal, not the latest one.
            utmSource: opportunity.utmSource ?? undefined,
            utmMedium: opportunity.utmMedium ?? undefined,
            utmCampaign: opportunity.utmCampaign ?? undefined,
            utmContent: opportunity.utmContent ?? undefined,
            utmTerm: opportunity.utmTerm ?? undefined,
            trafficType: opportunity.firstTrafficType ?? undefined,
            landingPage: opportunity.firstLandingPage ?? undefined,
          },
        };
      },
      systemAuthContext,
    );
  }
}
