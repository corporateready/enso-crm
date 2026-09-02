import { Module } from '@nestjs/common';

import { InboundActivityNameService } from 'src/modules/enso/inbound-activity/services/inbound-activity-name.service';
import { IngestCallEventJob } from 'src/modules/enso/telephony/jobs/ingest-call-event.job';
import { CallIdentityService } from 'src/modules/enso/telephony/services/call-identity.service';
import { PbxNumberService } from 'src/modules/enso/telephony/services/pbx-number.service';
import { CallIngestService } from 'src/modules/enso/telephony/services/call-ingest.service';

// WORKER side of telephony intake: the ingest job and the services it needs.
// Imported by JobsModule, which the queue worker loads — that is where the
// message-queue explorer discovers @Processor classes. InboundActivityNameService
// is re-provided here (rather than imported) because raw-ORM inserts bypass the
// create resolver, so the computed label has to be materialized by hand.
@Module({
  providers: [
    CallIngestService,
    PbxNumberService,
    CallIdentityService,
    InboundActivityNameService,
    IngestCallEventJob,
  ],
})
export class TelephonyJobsModule {}
