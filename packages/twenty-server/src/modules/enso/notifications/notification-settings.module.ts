import { Module } from '@nestjs/common';

import { SecureHttpClientModule } from 'src/engine/core-modules/secure-http-client/secure-http-client.module';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { GoogleChatWebhookModule } from 'src/modules/enso/notifications/google-chat-webhook.module';
import { NotificationSettingsResolver } from 'src/modules/enso/notifications/resolvers/notification-settings.resolver';
import { ProjectChatSettingsResolver } from 'src/modules/enso/notifications/resolvers/project-chat-settings.resolver';
import { MarketingSmsService } from 'src/modules/enso/marketing-sync/services/marketing-sms.service';
import { SmsMdClientService } from 'src/modules/enso/marketing-sync/services/sms-md-client.service';

// GlobalWorkspaceOrmManager (used by MarketingSmsService) is a global provider —
// no import needed. SecureHttpClientModule provides the client SmsMdClientService needs.
//
// PermissionsModule is required by ProjectChatSettingsResolver: its
// SettingsPermissionGuard is a mixin guard that injects PermissionsService, and a
// guard's dependencies are resolved from the module the RESOLVER lives in, not
// from wherever the guard was defined. Without it Nest fails at boot with
// "argument PermissionsService at index [0] is not available in the
// NotificationSettingsModule module" — a crash typecheck cannot see.
@Module({
  imports: [GoogleChatWebhookModule, SecureHttpClientModule, PermissionsModule],
  providers: [
    NotificationSettingsResolver,
    ProjectChatSettingsResolver,
    MarketingSmsService,
    SmsMdClientService,
  ],
})
export class NotificationSettingsModule {}
