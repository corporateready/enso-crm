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
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { GoogleChatNotificationPreference } from 'src/modules/enso/notifications/dtos/google-chat-notification-preference.dto';
import { GoogleChatTestResult } from 'src/modules/enso/notifications/dtos/google-chat-test-result.dto';
import { GoogleChatWebhookSettings } from 'src/modules/enso/notifications/dtos/google-chat-webhook-settings.dto';
import { SetGoogleChatWebhookUrlInput } from 'src/modules/enso/notifications/dtos/set-google-chat-webhook-url.input';
import {
  NOTIFICATION_EVENT_KEYS,
  type NotificationEventKey,
} from 'src/modules/enso/notifications/notifications.constants';
import { GoogleChatWebhookService } from 'src/modules/enso/notifications/services/google-chat-webhook.service';

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
  ) {}

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
