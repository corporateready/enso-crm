import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ToolModule } from 'src/engine/core-modules/tool/tool.module';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { MessagingSendManagerModule } from 'src/modules/messaging/message-outbound-manager/messaging-send-manager.module';
import { OutboundEmailResolver } from 'src/modules/enso/outbound-email/resolvers/outbound-email.resolver';
import { OutboundEmailService } from 'src/modules/enso/outbound-email/services/outbound-email.service';

// Manager 1:1 outbound email, mirroring NotificationSettingsModule's SMS wiring.
// GlobalWorkspaceOrmManager is a global provider (no import). ToolModule provides
// EmailComposerService (compose+sanitize) and MessagingSendManagerModule provides
// SendEmailService (the reused SMTP/Gmail sender). The core ConnectedAccount repo
// resolves the manager's own sending account.
@Module({
  imports: [
    ToolModule,
    MessagingSendManagerModule,
    TypeOrmModule.forFeature([ConnectedAccountEntity]),
  ],
  providers: [OutboundEmailResolver, OutboundEmailService],
  exports: [OutboundEmailService],
})
export class OutboundEmailModule {}
