import { Module } from '@nestjs/common';

import { SecureHttpClientModule } from 'src/engine/core-modules/secure-http-client/secure-http-client.module';
import { TelephonyOutboundResolver } from 'src/modules/enso/telephony/resolvers/telephony-outbound.resolver';
import { MoldcellPbxClientService } from 'src/modules/enso/telephony/services/moldcell-pbx-client.service';
import { TelephonyOutboundService } from 'src/modules/enso/telephony/services/telephony-outbound.service';

// Click-to-call, kept SEPARATE from TelephonyModule on purpose.
//
// TelephonyModule holds the PBX webhook controller and is imported by
// ModulesModule. A @MetadataResolver registered there never reaches the metadata
// GraphQL schema — that schema is built from the CoreEngineModule graph, which is
// where NotificationSettingsModule and OutboundEmailModule already live. A
// resolver in the wrong graph fails silently: the server boots clean and the
// mutation simply does not exist, which is exactly how the callViaPbx mutation
// shipped dead. So this module exists to be imported by CoreEngineModule.
//
// GlobalWorkspaceOrmManager is a global provider, so no import is needed for it.
@Module({
  imports: [SecureHttpClientModule],
  providers: [
    TelephonyOutboundResolver,
    TelephonyOutboundService,
    MoldcellPbxClientService,
  ],
})
export class TelephonyOutboundModule {}
