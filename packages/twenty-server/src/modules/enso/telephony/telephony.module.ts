import { Module } from '@nestjs/common';

import { SecureHttpClientModule } from 'src/engine/core-modules/secure-http-client/secure-http-client.module';
import { TelephonyController } from 'src/modules/enso/telephony/controllers/telephony.controller';
import { TelephonyOutboundResolver } from 'src/modules/enso/telephony/resolvers/telephony-outbound.resolver';
import { CallIdentityService } from 'src/modules/enso/telephony/services/call-identity.service';
import { MoldcellPbxClientService } from 'src/modules/enso/telephony/services/moldcell-pbx-client.service';
import { PbxNumberService } from 'src/modules/enso/telephony/services/pbx-number.service';
import { TelephonyContactService } from 'src/modules/enso/telephony/services/telephony-contact.service';
import { TelephonyOutboundService } from 'src/modules/enso/telephony/services/telephony-outbound.service';

// SERVER side of telephony intake: the public webhook receivers for the Moldcell
// PBX and Roistat. Imported by modules.module.ts only. The controller does no
// database work — it validates the shared secret, normalizes and enqueues — so
// the PBX always gets a fast ack even while a call is ringing. The worker side
// (the ingest job) lives in TelephonyJobsModule, loaded by JobsModule; the
// worker boots QueueWorkerModule and does not import this graph.
@Module({
  imports: [SecureHttpClientModule],
  controllers: [TelephonyController],
  // The contact responder runs on the server, not the worker: it answers the PBX
  // inline while the phone rings. GlobalWorkspaceOrmManager comes from a @Global
  // module, so no import is needed for ORM access. Click-to-call also lives here
  // rather than on the worker: a manager is waiting on the response.
  providers: [
    TelephonyContactService,
    CallIdentityService,
    PbxNumberService,
    MoldcellPbxClientService,
    TelephonyOutboundService,
    TelephonyOutboundResolver,
  ],
})
export class TelephonyModule {}
