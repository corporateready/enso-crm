import { Module } from '@nestjs/common';

import { MarketingFeedBackfillCommand } from 'src/modules/enso/marketing-sync/commands/marketing-feed-backfill.command';

// CLI-only module for the marketing-feed backfill command. Kept separate from
// MarketingSyncModule because that one loads in BOTH the server and the worker
// (the listener has to see events from either), and a one-off command has no
// business being constructed in those two runtimes. Imported by
// DatabaseCommandModule, which is what the CLI loads.
@Module({
  providers: [MarketingFeedBackfillCommand],
  exports: [MarketingFeedBackfillCommand],
})
export class MarketingFeedBackfillModule {}
