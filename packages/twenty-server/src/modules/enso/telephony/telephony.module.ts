import { Module } from '@nestjs/common';

import { TelephonyController } from 'src/modules/enso/telephony/controllers/telephony.controller';
import { CallIdentityService } from 'src/modules/enso/telephony/services/call-identity.service';
import { TelephonyContactService } from 'src/modules/enso/telephony/services/telephony-contact.service';

// SERVER side of telephony intake: the public webhook receivers for the Moldcell
// PBX and Roistat. Imported by modules.module.ts only. The controller does no
// database work — it validates the shared secret, normalizes and enqueues — so
// the PBX always gets a fast ack even while a call is ringing. The worker side
// (the ingest job) lives in TelephonyJobsModule, loaded by JobsModule; the
// worker boots QueueWorkerModule and does not import this graph.
@Module({
  controllers: [TelephonyController],
  // The contact responder runs on the server, not the worker: it answers the PBX
  // inline while the phone rings. GlobalWorkspaceOrmManager comes from a @Global
  // module, so no import is needed for ORM access.
  providers: [TelephonyContactService, CallIdentityService],
})
export class TelephonyModule {}
