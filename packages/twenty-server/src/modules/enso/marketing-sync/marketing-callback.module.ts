import { Module } from '@nestjs/common';

import { TokenModule } from 'src/engine/core-modules/auth/token/token.module';
import { SecureHttpClientModule } from 'src/engine/core-modules/secure-http-client/secure-http-client.module';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { WorkspaceCacheStorageModule } from 'src/engine/workspace-cache-storage/workspace-cache-storage.module';
import { MarketingController } from 'src/modules/enso/marketing-sync/controllers/marketing.controller';
import { MarketingReadController } from 'src/modules/enso/marketing-sync/controllers/marketing-read.controller';
import { DittofeedAdminClientService } from 'src/modules/enso/marketing-sync/services/dittofeed-admin-client.service';
import { MarketingConsentRevokeService } from 'src/modules/enso/marketing-sync/services/marketing-consent-revoke.service';
import { MarketingJourneyCallbackService } from 'src/modules/enso/marketing-sync/services/marketing-journey-callback.service';

// SERVER-only marketing HTTP surface (imported by modules.module.ts only):
//   - MarketingController       : PUBLIC journey-callback receiver (no JWT)
//   - MarketingReadController   : AUTHENTICATED deliveries proxy for the widget
// MarketingReadController's guards (JwtAuthGuard / WorkspaceAuthGuard /
// NoPermissionGuard) need AccessTokenService (TokenModule),
// WorkspaceCacheStorageService and the permissions providers resolvable in this
// module's injector — same wiring as ChatwootApiModule. Kept off the worker.
@Module({
  imports: [
    SecureHttpClientModule,
    TokenModule,
    WorkspaceCacheStorageModule,
    PermissionsModule,
  ],
  controllers: [MarketingController, MarketingReadController],
  providers: [
    MarketingJourneyCallbackService,
    MarketingConsentRevokeService,
    DittofeedAdminClientService,
  ],
})
export class MarketingCallbackModule {}
