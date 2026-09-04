import { Module } from '@nestjs/common';

import { KeyValuePairModule } from 'src/engine/core-modules/key-value-pair/key-value-pair.module';
import { SecretEncryptionModule } from 'src/engine/core-modules/secret-encryption/secret-encryption.module';
import { GoogleChatWebhookService } from 'src/modules/enso/notifications/services/google-chat-webhook.service';
import { ProjectChatWebhookService } from 'src/modules/enso/notifications/services/project-chat-webhook.service';

// Both Google Chat delivery lanes live here so every graph that already imports
// this module (the lead-pipeline worker included) gets the project lane without
// new wiring — the module-graph mistake that has bitten this codebase twice.
@Module({
  imports: [KeyValuePairModule, SecretEncryptionModule],
  providers: [GoogleChatWebhookService, ProjectChatWebhookService],
  exports: [GoogleChatWebhookService, ProjectChatWebhookService],
})
export class GoogleChatWebhookModule {}
