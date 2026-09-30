import { Module } from '@nestjs/common';

import { TokenModule } from 'src/engine/core-modules/auth/token/token.module';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { WorkspaceCacheStorageModule } from 'src/engine/workspace-cache-storage/workspace-cache-storage.module';
import { ChatwootWebhookController } from 'src/modules/enso/chatwoot/controllers/chatwoot-webhook.controller';
import { ChatwootController } from 'src/modules/enso/chatwoot/controllers/chatwoot.controller';
import { ChatwootModule } from 'src/modules/enso/chatwoot/chatwoot.module';
import { ChatwootNewMessageService } from 'src/modules/enso/chatwoot/services/chatwoot-new-message.service';
import { ManagerNotificationService } from 'src/modules/enso/lead-pipeline/services/manager-notification.service';
import { GoogleChatWebhookModule } from 'src/modules/enso/notifications/google-chat-webhook.module';

// HTTP side of Phase 5 — hosts the Chatwoot REST controller. Imported by
// ModulesModule so it mounts on the API server. The controller's guards need
// AccessTokenService (TokenModule), WorkspaceCacheStorageService, and the
// permissions providers (PermissionsModule) resolvable in THIS module's
// injector — mirrors how the AI generate-text controller's module is wired.
@Module({
  imports: [
    ChatwootModule,
    GoogleChatWebhookModule,
    TokenModule,
    WorkspaceCacheStorageModule,
    PermissionsModule,
  ],
  controllers: [ChatwootController, ChatwootWebhookController],
  // ManagerNotificationService is a plain provider (ORM + Google Chat), provided
  // here too so the webhook doesn't pull the lead-pipeline jobs graph into HTTP.
  providers: [ChatwootNewMessageService, ManagerNotificationService],
})
export class ChatwootApiModule {}
