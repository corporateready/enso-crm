import { Module } from '@nestjs/common';

import { SecureHttpClientModule } from 'src/engine/core-modules/secure-http-client/secure-http-client.module';
import { GoogleChatWebhookModule } from 'src/modules/enso/notifications/google-chat-webhook.module';
import { NotificationSettingsResolver } from 'src/modules/enso/notifications/resolvers/notification-settings.resolver';
import { ProjectChatSettingsResolver } from 'src/modules/enso/notifications/resolvers/project-chat-settings.resolver';
import { MarketingSmsService } from 'src/modules/enso/marketing-sync/services/marketing-sms.service';
import { SmsMdClientService } from 'src/modules/enso/marketing-sync/services/sms-md-client.service';

// GlobalWorkspaceOrmManager (used by MarketingSmsService) is a global provider —
// no import needed. SecureHttpClientModule provides the client SmsMdClientService needs.
@Module({
  imports: [GoogleChatWebhookModule, SecureHttpClientModule],
  providers: [
    NotificationSettingsResolver,
    ProjectChatSettingsResolver,
    MarketingSmsService,
    SmsMdClientService,
  ],
})
export class NotificationSettingsModule {}
