import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SecureHttpClientModule } from 'src/engine/core-modules/secure-http-client/secure-http-client.module';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { MarketingSmsService } from 'src/modules/enso/marketing-sync/services/marketing-sms.service';
import { SmsMdClientService } from 'src/modules/enso/marketing-sync/services/sms-md-client.service';
import { SmsDeliveryScannerCronCommand } from 'src/modules/enso/notifications/commands/sms-delivery-scanner.cron.command';
import { SmsDeliveryScannerCronJob } from 'src/modules/enso/notifications/jobs/sms-delivery-scanner.cron.job';

// The SMS delivery-receipt poll cron + its registration command. Imported by
// ModulesModule (so the worker runs the @Processor job) and DatabaseCommandModule
// (so cron:register:all schedules it), mirroring EnsoTaskDueModule.
// GlobalWorkspaceOrmManager + ExceptionHandlerService are global providers.
@Module({
  imports: [
    TypeOrmModule.forFeature([WorkspaceEntity]),
    SecureHttpClientModule,
  ],
  providers: [
    SmsDeliveryScannerCronJob,
    SmsDeliveryScannerCronCommand,
    MarketingSmsService,
    SmsMdClientService,
  ],
  exports: [SmsDeliveryScannerCronCommand],
})
export class EnsoSmsDeliveryModule {}
