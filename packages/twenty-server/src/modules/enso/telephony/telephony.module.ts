import { Module } from '@nestjs/common';

import { TelephonyController } from 'src/modules/enso/telephony/controllers/telephony.controller';

// SERVER side of telephony intake: the public webhook receivers for the Moldcell
// PBX and Roistat. Imported by modules.module.ts only. The controller does no
// database work — it validates the shared secret, normalizes and enqueues — so
// the PBX always gets a fast ack even while a call is ringing. The worker side
// (the ingest job) lives in TelephonyJobsModule, loaded by JobsModule; the
// worker boots QueueWorkerModule and does not import this graph.
@Module({
  controllers: [TelephonyController],
})
export class TelephonyModule {}
