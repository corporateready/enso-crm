import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { toE164 } from 'src/modules/enso/marketing-sync/marketing-sync.constants';
import { type SendSmsInput } from 'src/modules/enso/marketing-sync/dtos/send-sms.input';
import { SmsMdClientService } from 'src/modules/enso/marketing-sync/services/sms-md-client.service';
import { buildEnsoTimelineInserts } from 'src/modules/enso/timeline/enso-timeline.util';

// Relays a Dittofeed SMS journey step to sms.md and records a timeline event on
// the person, so the sales manager sees the SMS alongside the rest of the
// marketing journey (the whole point of the in-CRM visibility layer).
@Injectable()
export class MarketingSmsService {
  private readonly logger = new Logger(MarketingSmsService.name);

  constructor(
    private readonly smsMdClientService: SmsMdClientService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async send(input: SendSmsInput): Promise<void> {
    await this.smsMdClientService.send(input.workspaceId, {
      to: input.to,
      message: input.message,
    });

    if (isDefined(input.userId)) {
      await this.writeTimeline(input.workspaceId, input.userId);
    }
  }

  // Manager-initiated 1:1 SMS from a task. Server-side consent gate (authoritative):
  // the lead must have granted SMS for the deal's project, else the send is refused.
  // On success: sends via the chosen alias and logs an outboundActivity.
  async sendTaskSms(params: {
    workspaceId: string;
    taskId: string;
    message: string;
    alias?: string;
  }): Promise<{ success: boolean; error?: string }> {
    const { workspaceId, taskId, message, alias } = params;
    let result: { success: boolean; error?: string } = {
      success: false,
      error: 'Could not send SMS.',
    };

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const taskTargetRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'taskTarget',
          { shouldBypassPermissionChecks: true },
        );
      const opportunityRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'opportunity',
          { shouldBypassPermissionChecks: true },
        );
      const personRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'person',
          { shouldBypassPermissionChecks: true },
        );
      const consentRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'personProjectConsent',
          { shouldBypassPermissionChecks: true },
        );
      const outboundActivityRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'outboundActivity',
          { shouldBypassPermissionChecks: true },
        );

      const targets = await taskTargetRepository.find({ where: { taskId } });
      const opportunityId = targets.find((target: any) =>
        isDefined(target.targetOpportunityId),
      )?.targetOpportunityId as string | undefined;
      const personId = targets.find((target: any) =>
        isDefined(target.targetPersonId),
      )?.targetPersonId as string | undefined;

      if (!isDefined(personId)) {
        result = {
          success: false,
          error: 'No contact is linked to this task.',
        };

        return;
      }

      const person = await personRepository.findOne({
        where: { id: personId },
      });
      const to = toE164(
        person?.phones?.primaryPhoneCallingCode,
        person?.phones?.primaryPhoneNumber,
      );

      if (!isDefined(to)) {
        result = {
          success: false,
          error: 'No phone number on file for this contact.',
        };

        return;
      }

      // Resolve the deal's project so we check consent for the right project.
      let projectId: string | undefined;

      if (isDefined(opportunityId)) {
        const opportunity = await opportunityRepository.findOne({
          where: { id: opportunityId },
        });

        projectId = (opportunity?.projectId as string | undefined) ?? undefined;
      }

      const consents = await consentRepository.find({ where: { personId } });
      const consent = isDefined(projectId)
        ? consents.find((row: any) => row.projectId === projectId)
        : consents[0];

      if (consent?.smsMarketingConsent !== true) {
        result = {
          success: false,
          error: 'This lead has not granted SMS consent.',
        };

        return;
      }

      await this.smsMdClientService.send(workspaceId, {
        to,
        message,
        ...(isDefined(alias) ? { from: alias } : {}),
      });

      await outboundActivityRepository.save({
        channel: 'SMS',
        loggedVia: 'CRM_INITIATED',
        body: message,
        ...(isDefined(alias) ? { fromIdentity: alias } : {}),
        occurredAt: new Date(),
        taskId,
        ...(isDefined(opportunityId) ? { opportunityId } : {}),
        personId,
      });

      result = { success: true };
    }, buildSystemAuthContext(workspaceId));

    return result;
  }

  // Best-effort: a timeline failure must not fail the SMS send.
  private async writeTimeline(
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    try {
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const timelineRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'timelineActivity',
              { shouldBypassPermissionChecks: true },
            );

          const rows = buildEnsoTimelineInserts({
            action: 'marketing-sms-sent',
            target: { personId: userId },
            segments: [{ text: 'Sent a marketing SMS' }],
            auto: true,
            happensAt: new Date().toISOString(),
          });

          if (rows.length > 0) {
            await timelineRepository.insert(rows);
          }
        },
        buildSystemAuthContext(workspaceId),
      );
    } catch (error) {
      this.logger.warn(
        `marketing SMS timeline write failed for person ${userId}: ${
          (error as Error).message
        }`,
      );
    }
  }
}
