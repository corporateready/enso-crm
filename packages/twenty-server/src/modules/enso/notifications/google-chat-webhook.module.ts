import { Module } from '@nestjs/common';

import { KeyValuePairModule } from 'src/engine/core-modules/key-value-pair/key-value-pair.module';
import { SecretEncryptionModule } from 'src/engine/core-modules/secret-encryption/secret-encryption.module';
import { GoogleChatWebhookService } from 'src/modules/enso/notifications/services/google-chat-webhook.service';

@Module({
  imports: [KeyValuePairModule, SecretEncryptionModule],
  providers: [GoogleChatWebhookService],
  exports: [GoogleChatWebhookService],
})
export class GoogleChatWebhookModule {}
