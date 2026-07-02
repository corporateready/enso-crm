import { UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';

import { isDefined } from 'twenty-shared/utils';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { AuthGraphqlApiExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-graphql-api-exception.filter';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthUser } from 'src/engine/decorators/auth/auth-user.decorator';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { AuthWorkspaceMemberId } from 'src/engine/decorators/auth/auth-workspace-member-id.decorator';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { GoogleChatNotificationPreference } from 'src/modules/enso/notifications/dtos/google-chat-notification-preference.dto';
import { GoogleChatTestResult } from 'src/modules/enso/notifications/dtos/google-chat-test-result.dto';
import { GoogleChatWebhookSettings } from 'src/modules/enso/notifications/dtos/google-chat-webhook-settings.dto';
import { SetGoogleChatWebhookUrlInput } from 'src/modules/enso/notifications/dtos/set-google-chat-webhook-url.input';
import { PersonSmsContext } from 'src/modules/enso/notifications/dtos/person-sms-context.dto';
import { TaskSmsContext } from 'src/modules/enso/notifications/dtos/task-sms-context.dto';
import {
  NOTIFICATION_EVENT_KEYS,
  type NotificationEventKey,
} from 'src/modules/enso/notifications/notifications.constants';
import { GoogleChatWebhookService } from 'src/modules/enso/notifications/services/google-chat-webhook.service';
import { MarketingSmsService } from 'src/modules/enso/marketing-sync/services/marketing-sms.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

// Each manager manages their OWN personal Google Chat webhook (the private space
// that receives their CRM alerts). No special permission — being a signed-in
// member is enough; everything is scoped to (user, workspace).
@MetadataResolver()
@UsePipes(ResolverValidationPipe)
@UseFilters(AuthGraphqlApiExceptionFilter)
// WorkspaceAuthGuard = must be a signed-in member; NoPermissionGuard = no extra
// workspace permission needed (everyone manages their OWN notification settings).
@UseGuards(WorkspaceAuthGuard, NoPermissionGuard)
export class NotificationSettingsResolver {
  constructor(
    private readonly googleChatWebhookService: GoogleChatWebhookService,
    private readonly marketingSmsService: MarketingSmsService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  // The "continue on phone" handoff must reach whoever is WORKING the task — its
  // assignee — not whoever happens to click (an admin viewing the task would
  // otherwise ping their own space). Resolve assignee → workspaceMember.userId.
  // Returns undefined when the task has no assignee, so callers fall back to the
  // clicking user.
  private async resolveTaskAssigneeUserId(
    workspaceId: string,
    taskId: string,
  ): Promise<string | undefined> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const taskRepository =
          await this.globalWorkspaceOrmManager.getRepository<any>(
            workspaceId,
            'task',
            { shouldBypassPermissionChecks: true },
          );
        const task = await taskRepository.findOne({
          where: { id: taskId },
          select: { id: true, assigneeId: true },
        });
        const assigneeId = task?.assigneeId;

        if (!isDefined(assigneeId)) {
          return undefined;
        }

        const workspaceMemberRepository =
          await this.globalWorkspaceOrmManager.getRepository<any>(
            workspaceId,
            'workspaceMember',
            { shouldBypassPermissionChecks: true },
          );
        const assignee = await workspaceMemberRepository.findOne({
          where: { id: assigneeId },
          select: { id: true, userId: true },
        });

        return isDefined(assignee?.userId) ? assignee.userId : undefined;
      },
      buildSystemAuthContext(workspaceId),
    );
  }

  @Query(() => GoogleChatWebhookSettings)
  async googleChatWebhookSettings(
    @AuthUser() user: UserEntity,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<GoogleChatWebhookSettings> {
    const maskedWebhookUrl =
      await this.googleChatWebhookService.getMaskedWebhookUrl({
        userId: user.id,
        workspaceId: workspace.id,
      });

    return {
      isConfigured: isDefined(maskedWebhookUrl),
      maskedWebhookUrl,
    };
  }

  @Mutation(() => GoogleChatWebhookSettings)
  async setGoogleChatWebhookUrl(
    @Args('input') input: SetGoogleChatWebhookUrlInput,
    @AuthUser() user: UserEntity,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<GoogleChatWebhookSettings> {
    await this.googleChatWebhookService.setWebhookUrl({
      userId: user.id,
      workspaceId: workspace.id,
      webhookUrl: input.webhookUrl,
    });

    const maskedWebhookUrl =
      await this.googleChatWebhookService.getMaskedWebhookUrl({
        userId: user.id,
        workspaceId: workspace.id,
      });

    return {
      isConfigured: true,
      maskedWebhookUrl,
    };
  }

  @Mutation(() => Boolean)
  async deleteGoogleChatWebhookUrl(
    @AuthUser() user: UserEntity,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<boolean> {
    await this.googleChatWebhookService.deleteWebhookUrl({
      userId: user.id,
      workspaceId: workspace.id,
    });

    return true;
  }

  @Mutation(() => GoogleChatTestResult)
  async sendGoogleChatTestNotification(
    @AuthUser() user: UserEntity,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<GoogleChatTestResult> {
    const webhookUrl = await this.googleChatWebhookService.getWebhookUrl({
      userId: user.id,
      workspaceId: workspace.id,
    });

    if (!isDefined(webhookUrl)) {
      return { success: false, error: 'No webhook configured yet.' };
    }

    const succeeded = await this.googleChatWebhookService.post(webhookUrl, {
      cardsV2: [
        {
          cardId: 'enso-crm-test',
          card: {
            header: {
              title: '✅ ENSO CRM connected',
              subtitle: 'Your personal notification space is wired up.',
            },
            sections: [
              {
                widgets: [
                  {
                    decoratedText: {
                      startIcon: { knownIcon: 'STAR' },
                      text: 'You will receive your CRM alerts here.',
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    return succeeded
      ? { success: true }
      : {
          success: false,
          error: 'Could not reach Google Chat. Check the URL.',
        };
  }

  // Preflight for the compose modal: the sender alias determined from the deal's
  // project + whether the SMS may be sent (phone on file, project alias, consent).
  @Query(() => TaskSmsContext)
  async taskSmsContext(
    @Args('taskId', { type: () => String }) taskId: string,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<TaskSmsContext> {
    return this.marketingSmsService.getTaskSmsContext({
      workspaceId: workspace.id,
      taskId,
    });
  }

  // Manager-initiated corporate SMS from a task. Consent AND the sender alias are
  // enforced server-side inside MarketingSmsService (the alias comes from the
  // deal's project, never the client — refuses if no consent / no project alias).
  @Mutation(() => GoogleChatTestResult)
  async sendTaskSms(
    @Args('taskId', { type: () => String }) taskId: string,
    @Args('message', { type: () => String }) message: string,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthWorkspaceMemberId() workspaceMemberId: string,
  ): Promise<GoogleChatTestResult> {
    if (!isDefined(message) || message.trim() === '') {
      return { success: false, error: 'Message is empty.' };
    }

    return this.marketingSmsService.sendTaskSms({
      workspaceId: workspace.id,
      taskId,
      message,
      workspaceMemberId,
    });
  }

  // Object/standalone SMS preflight: alias + sendability for a chosen deal+contact.
  @Query(() => TaskSmsContext)
  async recordSmsContext(
    @Args('opportunityId', { type: () => String, nullable: true })
    opportunityId: string | null,
    @Args('personId', { type: () => String, nullable: true })
    personId: string | null,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<TaskSmsContext> {
    return this.marketingSmsService.getRecordSmsContext({
      workspaceId: workspace.id,
      ...(isDefined(opportunityId) ? { opportunityId } : {}),
      ...(isDefined(personId) ? { personId } : {}),
    });
  }

  // Object/standalone corporate SMS: same server-side consent + alias rules as
  // sendTaskSms, but keyed by the chosen deal + contact (logs without a taskId).
  @Mutation(() => GoogleChatTestResult)
  async sendRecordSms(
    @Args('opportunityId', { type: () => String, nullable: true })
    opportunityId: string | null,
    @Args('personId', { type: () => String, nullable: true })
    personId: string | null,
    @Args('message', { type: () => String }) message: string,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthWorkspaceMemberId() workspaceMemberId: string,
  ): Promise<GoogleChatTestResult> {
    if (!isDefined(message) || message.trim() === '') {
      return { success: false, error: 'Message is empty.' };
    }

    return this.marketingSmsService.sendRecordSms({
      workspaceId: workspace.id,
      ...(isDefined(opportunityId) ? { opportunityId } : {}),
      ...(isDefined(personId) ? { personId } : {}),
      message,
      workspaceMemberId,
    });
  }

  // Person-keyed SMS preflight (object/launcher): the aliases the contact may be
  // reached under (their consented projects' brands).
  @Query(() => PersonSmsContext)
  async personSmsContext(
    @Args('personId', { type: () => String, nullable: true })
    personId: string | null,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<PersonSmsContext> {
    return this.marketingSmsService.getPersonSmsContext({
      workspaceId: workspace.id,
      ...(isDefined(personId) ? { personId } : {}),
    });
  }

  // Person-keyed corporate SMS: the chosen alias must be one the contact
  // consented to (validated server-side). Optional deal links the activity.
  @Mutation(() => GoogleChatTestResult)
  async sendPersonSms(
    @Args('personId', { type: () => String, nullable: true })
    personId: string | null,
    @Args('message', { type: () => String }) message: string,
    @Args('alias', { type: () => String, nullable: true }) alias: string | null,
    @Args('opportunityId', { type: () => String, nullable: true })
    opportunityId: string | null,
    @Args('taskId', { type: () => String, nullable: true })
    taskId: string | null,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthWorkspaceMemberId() workspaceMemberId: string,
  ): Promise<GoogleChatTestResult> {
    if (!isDefined(message) || message.trim() === '') {
      return { success: false, error: 'Message is empty.' };
    }

    return this.marketingSmsService.sendPersonSms({
      workspaceId: workspace.id,
      ...(isDefined(personId) ? { personId } : {}),
      ...(isDefined(alias) ? { alias } : {}),
      ...(isDefined(opportunityId) ? { opportunityId } : {}),
      ...(isDefined(taskId) ? { taskId } : {}),
      message,
      workspaceMemberId,
    });
  }

  // Desktop → mobile handoff: ping the current manager's OWN Chat space with a
  // deep-link to this task, so they can pick it up on their phone (Actions tab).
  @Mutation(() => GoogleChatTestResult)
  async sendTaskToMyPhone(
    @Args('taskId', { type: () => String }) taskId: string,
    @AuthUser() user: UserEntity,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<GoogleChatTestResult> {
    // Route to the task's assignee (whoever is working it), not the clicker.
    // Fall back to the clicker when the task is unassigned.
    const assigneeUserId = await this.resolveTaskAssigneeUserId(
      workspace.id,
      taskId,
    );
    const targetUserId = assigneeUserId ?? user.id;
    const isRoutingToOtherUser =
      isDefined(assigneeUserId) && assigneeUserId !== user.id;

    const webhookUrl = await this.googleChatWebhookService.getWebhookUrl({
      userId: targetUserId,
      workspaceId: workspace.id,
    });

    if (!isDefined(webhookUrl)) {
      return {
        success: false,
        error: isRoutingToOtherUser
          ? "The assignee hasn't connected their Google Chat yet."
          : 'Connect Google Chat in Settings → Notifications first.',
      };
    }

    const appUrl = (
      process.env.ENSO_CRM_APP_URL ||
      process.env.FRONTEND_URL ||
      ''
    ).replace(/\/$/, '');
    const taskUrl = appUrl ? `${appUrl}/object/task/${taskId}` : undefined;

    const actionWidget: Record<string, unknown> = isDefined(taskUrl)
      ? {
          buttonList: {
            buttons: [
              { text: 'Open task', onClick: { openLink: { url: taskUrl } } },
            ],
          },
        }
      : {
          decoratedText: {
            startIcon: { knownIcon: 'DESCRIPTION' },
            text: 'Open the CRM on your phone to continue.',
          },
        };

    const succeeded = await this.googleChatWebhookService.post(webhookUrl, {
      cardsV2: [
        {
          cardId: 'enso-crm-continue-on-phone',
          card: {
            header: {
              title: '📱 Continue on your phone',
              subtitle: 'Open this task to log the touch from mobile.',
            },
            sections: [{ widgets: [actionWidget] }],
          },
        },
      ],
    });

    return succeeded
      ? { success: true }
      : { success: false, error: 'Could not reach Google Chat.' };
  }

  @Query(() => [GoogleChatNotificationPreference])
  async notificationPreferences(
    @AuthUser() user: UserEntity,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<GoogleChatNotificationPreference[]> {
    const preferences = await this.googleChatWebhookService.getPreferences({
      userId: user.id,
      workspaceId: workspace.id,
    });

    return NOTIFICATION_EVENT_KEYS.map((event) => ({
      event,
      enabled: preferences[event] !== false,
    }));
  }

  @Mutation(() => [GoogleChatNotificationPreference])
  async setNotificationPreference(
    @Args('event', { type: () => String }) event: string,
    @Args('enabled', { type: () => Boolean }) enabled: boolean,
    @AuthUser() user: UserEntity,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<GoogleChatNotificationPreference[]> {
    if (!NOTIFICATION_EVENT_KEYS.includes(event as NotificationEventKey)) {
      throw new Error(`Unknown notification event: ${event}`);
    }

    await this.googleChatWebhookService.setPreference({
      userId: user.id,
      workspaceId: workspace.id,
      event: event as NotificationEventKey,
      enabled,
    });

    return this.notificationPreferences(user, workspace);
  }
}
