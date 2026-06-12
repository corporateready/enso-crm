import { Module } from '@nestjs/common';

import { MarketingController } from 'src/modules/enso/marketing-sync/controllers/marketing.controller';
import { MarketingJourneyCallbackService } from 'src/modules/enso/marketing-sync/services/marketing-journey-callback.service';

// SERVER-only: the public journey-callback HTTP endpoint (Dittofeed → CRM,
// connection (4)). Kept separate from MarketingSyncModule because that module
// is loaded by BOTH the API server and the worker; this controller only makes
// sense on the API server. Imported by modules.module.ts only.
@Module({
  controllers: [MarketingController],
  providers: [MarketingJourneyCallbackService],
})
export class MarketingCallbackModule {}
