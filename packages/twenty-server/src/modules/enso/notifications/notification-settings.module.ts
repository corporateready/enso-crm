import { Module } from '@nestjs/common';

import { GoogleChatWebhookModule } from 'src/modules/enso/notifications/google-chat-webhook.module';
import { NotificationSettingsResolver } from 'src/modules/enso/notifications/resolvers/notification-settings.resolver';

@Module({
  imports: [GoogleChatWebhookModule],
  providers: [NotificationSettingsResolver],
})
export class NotificationSettingsModule {}
