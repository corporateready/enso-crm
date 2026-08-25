import { Logger } from '@nestjs/common';

import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import {
  deserializeCallEvent,
  type IngestCallEventJobData,
} from 'src/modules/enso/telephony/jobs/telephony-job.types';
import { CallIngestService } from 'src/modules/enso/telephony/services/call-ingest.service';

// Telephony intake runs off the queue rather than inline in the controller: the
// PBX and Roistat both expect a fast ack, and a slow response to the PBX sits in
// the path of a live call. The controller validates and enqueues; all database
// work happens here so a retry is cheap and independent.
@Processor(MessageQueue.ensoTelephonyQueue)
export class IngestCallEventJob {
  private readonly logger = new Logger(IngestCallEventJob.name);

  constructor(private readonly callIngestService: CallIngestService) {}

  @Process(IngestCallEventJob.name)
  async handle(data: IngestCallEventJobData): Promise<void> {
    const { workspaceId, event } = data;

    const result = await this.callIngestService.ingest(
      workspaceId,
      deserializeCallEvent(event),
    );

    if (!result) {
      this.logger.warn(
        `Telephony ingest produced no activity for ${event.externalId}`,
      );

      return;
    }

    // Opportunity resolution is intentionally NOT enqueued yet: it hard-requires
    // personId + projectId, and identity resolution (find-or-create Person from
    // the caller, project from the Roistat project code / PBX department) is the
    // next increment. Until then calls land as visible activities without
    // producing deals, which is the safe half of the behaviour.
    this.logger.log(
      `Telephony ingest ${result.created ? 'created' : 'updated'} activity ${result.activityId}`,
    );
  }
}
