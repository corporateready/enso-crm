import { Logger } from '@nestjs/common';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { type ArchiveCallRecordingJobData } from 'src/modules/enso/telephony/jobs/telephony-job.types';
import { CallRecordingArchiveService } from 'src/modules/enso/telephony/services/call-recording-archive.service';
import {
  RECORDING_FETCH_RETRIES,
  RECORDING_RETRY_DELAY_MS,
} from 'src/modules/enso/telephony/telephony.constants';

// Pulls the call recording into the workspace's own storage. Separate from the
// ingest job on purpose: downloading audio is slow and can legitimately fail for
// a while (the PBX writes the file after the call ends, so `history` regularly
// arrives before the audio exists), and none of that should hold up or retry the
// database work that makes the call visible in the CRM.
@Processor(MessageQueue.ensoTelephonyQueue)
export class ArchiveCallRecordingJob {
  private readonly logger = new Logger(ArchiveCallRecordingJob.name);

  constructor(
    private readonly callRecordingArchiveService: CallRecordingArchiveService,
    @InjectMessageQueue(MessageQueue.ensoTelephonyQueue)
    private readonly telephonyQueueService: MessageQueueService,
  ) {}

  @Process(ArchiveCallRecordingJob.name)
  async handle(data: ArchiveCallRecordingJobData): Promise<void> {
    const {
      workspaceId,
      recordingUrl,
      objectNameSingular,
      activityId,
      occurredAtIso,
      attempt = 1,
    } = data;

    const archived = await this.callRecordingArchiveService.archive(
      workspaceId,
      recordingUrl,
      {
        objectNameSingular,
        activityId,
        ...(occurredAtIso ? { occurredAt: new Date(occurredAtIso) } : {}),
      },
    );

    if (archived) {
      return;
    }

    if (attempt >= RECORDING_FETCH_RETRIES) {
      // The activity keeps the PBX link either way, so a give-up here loses the
      // durable copy, not the call.
      this.logger.warn(
        `Giving up on recording for ${objectNameSingular} ${activityId} after ${attempt} attempts`,
      );

      return;
    }

    // Re-enqueue with a delay rather than throw: a BullMQ retry would use the
    // queue's own backoff, which is tuned for transient database errors and far
    // too fast for "the PBX has not finished writing the file".
    await this.telephonyQueueService.add<ArchiveCallRecordingJobData>(
      ArchiveCallRecordingJob.name,
      { ...data, attempt: attempt + 1 },
      {
        id: `enso-telephony-recording:${activityId}:${attempt + 1}`,
        delay: RECORDING_RETRY_DELAY_MS,
      },
    );
  }
}
