import { Module } from '@nestjs/common';

import { SecureHttpClientModule } from 'src/engine/core-modules/secure-http-client/secure-http-client.module';
import { MarketingSyncJob } from 'src/modules/enso/marketing-sync/jobs/marketing-sync.job';
import { DittofeedAdminClientService } from 'src/modules/enso/marketing-sync/services/dittofeed-admin-client.service';
import { DittofeedClientService } from 'src/modules/enso/marketing-sync/services/dittofeed-client.service';

// Worker-side module: the BullMQ processor + the Dittofeed HTTP clients (public
// write key for identify/track; admin key for the consent → subscription
// mirror).
// Imported by the worker JobsModule.
@Module({
  imports: [SecureHttpClientModule],
  providers: [
    MarketingSyncJob,
    DittofeedClientService,
    DittofeedAdminClientService,
  ],
})
export class MarketingSyncJobsModule {}
