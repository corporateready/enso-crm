import { Module } from '@nestjs/common';

import { SecureHttpClientModule } from 'src/engine/core-modules/secure-http-client/secure-http-client.module';
import { MarketingController } from 'src/modules/enso/marketing-sync/controllers/marketing.controller';
import { MarketingReadController } from 'src/modules/enso/marketing-sync/controllers/marketing-read.controller';
import { DittofeedAdminClientService } from 'src/modules/enso/marketing-sync/services/dittofeed-admin-client.service';
import { MarketingJourneyCallbackService } from 'src/modules/enso/marketing-sync/services/marketing-journey-callback.service';

// SERVER-only marketing HTTP surface (imported by modules.module.ts only):
//   - MarketingController       : PUBLIC journey-callback receiver (no JWT)
//   - MarketingReadController   : AUTHENTICATED deliveries proxy for the widget
// Kept off the worker (controllers only make sense on the API server).
@Module({
  imports: [SecureHttpClientModule],
  controllers: [MarketingController, MarketingReadController],
  providers: [MarketingJourneyCallbackService, DittofeedAdminClientService],
})
export class MarketingCallbackModule {}
