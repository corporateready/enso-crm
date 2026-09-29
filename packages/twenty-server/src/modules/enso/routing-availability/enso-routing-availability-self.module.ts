import { Module } from '@nestjs/common';

import { SecureHttpClientModule } from 'src/engine/core-modules/secure-http-client/secure-http-client.module';

import { EnsoPostHogService } from 'src/modules/enso/routing-availability/services/enso-posthog.service';
import { RoutingAvailabilityAuditService } from 'src/modules/enso/routing-availability/services/routing-availability-audit.service';
import { RoutingAvailabilitySelfService } from 'src/modules/enso/routing-availability/services/routing-availability-self.service';
import { RoutingAvailabilityResolver } from 'src/modules/enso/routing-availability/resolvers/routing-availability.resolver';
import { MoldcellPbxClientService } from 'src/modules/enso/telephony/services/moldcell-pbx-client.service';
import { PbxCallReceptionSyncService } from 'src/modules/enso/telephony/services/pbx-call-reception-sync.service';

// Kept SEPARATE from RoutingAvailabilityModule, which holds the query hook and
// is imported by ModulesModule. A @MetadataResolver only reaches the metadata
// GraphQL schema from the CoreEngineModule graph, and a resolver in the wrong
// graph fails silently. See TelephonyOutboundModule.
@Module({
  imports: [SecureHttpClientModule],
  providers: [
    RoutingAvailabilityResolver,
    RoutingAvailabilitySelfService,
    RoutingAvailabilityAuditService,
    EnsoPostHogService,
    MoldcellPbxClientService,
    PbxCallReceptionSyncService,
  ],
})
export class EnsoRoutingAvailabilitySelfModule {}
