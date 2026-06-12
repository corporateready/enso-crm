import { Module } from '@nestjs/common';

import { MarketingSyncListener } from 'src/modules/enso/marketing-sync/listeners/marketing-sync.listener';

// CRM → Dittofeed event listener. Must load wherever workspace DB events fire:
// the server (GraphQL writes) AND the worker (intake/scanner ORM writes) — so
// it's imported by both modules.module.ts and the worker JobsModule. The
// listener enqueues to ensoMarketingSyncQueue; MarketingSyncJobsModule (worker)
// holds the processor that actually calls Dittofeed.
@Module({
  providers: [MarketingSyncListener],
})
export class MarketingSyncModule {}
