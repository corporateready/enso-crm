import { Module } from '@nestjs/common';

import { CalendarModule } from 'src/modules/calendar/calendar.module';
import { ConnectedAccountModule } from 'src/modules/connected-account/connected-account.module';
import { ChatwootApiModule } from 'src/modules/enso/chatwoot/chatwoot-api.module';
import { MarketingSyncModule } from 'src/modules/enso/marketing-sync/marketing-sync.module';
import { EnsoSequencingModule } from 'src/modules/enso/sequencing/sequencing.module';
import { MessagingModule } from 'src/modules/messaging/messaging.module';
import { WorkflowModule } from 'src/modules/workflow/workflow.module';
import { WorkspaceMemberModule } from 'src/modules/workspace-member/workspace-member.module';

@Module({
  imports: [
    MessagingModule,
    CalendarModule,
    ConnectedAccountModule,
    ChatwootApiModule,
    EnsoSequencingModule,
    MarketingSyncModule,
    WorkflowModule,
    WorkspaceMemberModule,
  ],
  providers: [],
  exports: [],
})
export class ModulesModule {}
