import { Injectable, Logger } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { toE164 } from 'src/modules/enso/marketing-sync/marketing-sync.constants';
import { type SendSmsInput } from 'src/modules/enso/marketing-sync/dtos/send-sms.input';
import {
  isFinalSmsDeliveryStatus,
  SmsMdClientService,
} from 'src/modules/enso/marketing-sync/services/sms-md-client.service';
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

  // Resolve everything an SMS-from-task needs and whether it may be sent. The
  // sender alias is AUTHORITATIVE from the deal's project (project.smsAlias) —
  // never trusted from the client — so a manager can't send under a brand the
  // lead didn't consent to. Shared by the send and the modal preflight.
  async resolveTaskSmsContext(
    workspaceId: string,
    taskId: string,
  ): Promise<{
    personId?: string;
    to?: string;
    opportunityId?: string;
    alias?: string;
    canSend: boolean;
    reason?: string;
  }> {
    let context: {
      personId?: string;
      to?: string;
      opportunityId?: string;
      alias?: string;
      canSend: boolean;
      reason?: string;
    } = { canSend: false, reason: 'Could not resolve this task.' };

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
      const projectRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'project',
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

      const targets = await taskTargetRepository.find({ where: { taskId } });
      const opportunityId = targets.find((target: any) =>
        isDefined(target.targetOpportunityId),
      )?.targetOpportunityId as string | undefined;
      const personId = targets.find((target: any) =>
        isDefined(target.targetPersonId),
      )?.targetPersonId as string | undefined;

      if (!isDefined(personId)) {
        context = {
          canSend: false,
          reason: 'No contact is linked to this task.',
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
        context = {
          personId,
          opportunityId,
          canSend: false,
          reason: 'No phone number on file for this contact.',
        };

        return;
      }

      // The deal's project drives BOTH the consent check and the sender alias.
      let projectId: string | undefined;

      if (isDefined(opportunityId)) {
        const opportunity = await opportunityRepository.findOne({
          where: { id: opportunityId },
        });

        projectId = (opportunity?.projectId as string | undefined) ?? undefined;
      }

      const alias = isDefined(projectId)
        ? (((await projectRepository.findOne({ where: { id: projectId } }))
            ?.smsAlias as string | undefined) ?? undefined)
        : undefined;

      if (!isNonEmptyString(alias)) {
        context = {
          personId,
          to,
          opportunityId,
          canSend: false,
          reason: "No SMS sender is configured for this deal's project.",
        };

        return;
      }

      const consents = await consentRepository.find({ where: { personId } });
      const consent = isDefined(projectId)
        ? consents.find((row: any) => row.projectId === projectId)
        : consents[0];

      if (consent?.smsMarketingConsent !== true) {
        context = {
          personId,
          to,
          opportunityId,
          alias,
          canSend: false,
          reason: 'This lead has not granted SMS consent.',
        };

        return;
      }

      context = { personId, to, opportunityId, alias, canSend: true };
    }, buildSystemAuthContext(workspaceId));

    return context;
  }

  // What the compose modal needs: the determined alias + whether send is allowed.
  async getTaskSmsContext(params: {
    workspaceId: string;
    taskId: string;
  }): Promise<{
    alias: string | null;
    canSend: boolean;
    reason: string | null;
  }> {
    const context = await this.resolveTaskSmsContext(
      params.workspaceId,
      params.taskId,
    );

    return {
      alias: context.alias ?? null,
      canSend: context.canSend,
      reason: context.reason ?? null,
    };
  }

  // Manager-initiated 1:1 SMS from a task. Consent + sender alias are resolved
  // server-side (authoritative). On success: sends via the project's alias,
  // logs an outboundActivity, and stamps it QUEUED for delivery-receipt polling.
  async sendTaskSms(params: {
    workspaceId: string;
    taskId: string;
    message: string;
  }): Promise<{ success: boolean; error?: string }> {
    const { workspaceId, taskId, message } = params;
    const context = await this.resolveTaskSmsContext(workspaceId, taskId);

    if (
      !context.canSend ||
      !isNonEmptyString(context.to) ||
      !isNonEmptyString(context.alias)
    ) {
      return { success: false, error: context.reason ?? 'Could not send SMS.' };
    }

    const { to, alias, opportunityId, personId } = context;

    await this.smsMdClientService.send(workspaceId, {
      to,
      message,
      from: alias,
    });

    // sms.md /send returns no id → correlate the just-queued message so we can
    // poll its delivery status later. Best-effort; null externalId just means
    // the activity stays QUEUED (no DLR) rather than failing the send.
    const externalId = await this.smsMdClientService.findRecentMessageId(
      workspaceId,
      { to, message },
    );

    let result: { success: boolean; error?: string } = {
      success: false,
      error: 'Could not log the SMS.',
    };

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const outboundActivityRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'outboundActivity',
          { shouldBypassPermissionChecks: true },
        );

      await outboundActivityRepository.save({
        channel: 'SMS',
        loggedVia: 'CRM_INITIATED',
        body: message,
        fromIdentity: alias,
        deliveryStatus: 'QUEUED',
        occurredAt: new Date(),
        taskId,
        ...(isDefined(externalId) ? { externalId } : {}),
        ...(isDefined(opportunityId) ? { opportunityId } : {}),
        personId,
      });

      result = { success: true };
    }, buildSystemAuthContext(workspaceId));

    return result;
  }

  // Delivery-receipt poll (sms.md is poll-only, no push DLR). For recent SMS
  // activities still in a non-final state that carry an sms.md message id,
  // refresh deliveryStatus. Silent: updates the field, no timeline event.
  async pollDeliveryStatuses(workspaceId: string): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const outboundActivityRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'outboundActivity',
          { shouldBypassPermissionChecks: true },
        );

      const rows = await outboundActivityRepository.find({
        where: { channel: 'SMS' },
        order: { createdAt: 'DESC' },
        take: 200,
      });

      const pending = rows.filter(
        (row: any) =>
          isNonEmptyString(row.externalId) &&
          new Date(row.createdAt) > cutoff &&
          !isFinalSmsDeliveryStatus(row.deliveryStatus),
      );

      for (const row of pending) {
        const status = await this.smsMdClientService.getDeliveryStatus(
          workspaceId,
          row.externalId,
        );

        if (isDefined(status) && status !== row.deliveryStatus) {
          await outboundActivityRepository.update(row.id, {
            deliveryStatus: status,
          });
        }
      }
    }, buildSystemAuthContext(workspaceId));
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
