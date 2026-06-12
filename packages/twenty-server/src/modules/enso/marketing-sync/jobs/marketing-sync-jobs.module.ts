import { Module } from '@nestjs/common';

import { SecureHttpClientModule } from 'src/engine/core-modules/secure-http-client/secure-http-client.module';
import { MarketingSyncJob } from 'src/modules/enso/marketing-sync/jobs/marketing-sync.job';
import { DittofeedClientService } from 'src/modules/enso/marketing-sync/services/dittofeed-client.service';

// Worker-side module: the BullMQ processor + the Dittofeed HTTP client.
// Imported by the worker JobsModule.
@Module({
  imports: [SecureHttpClientModule],
  providers: [MarketingSyncJob, DittofeedClientService],
})
export class MarketingSyncJobsModule {}
