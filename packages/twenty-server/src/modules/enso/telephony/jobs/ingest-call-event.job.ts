import { Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { type ResolveOpportunityFromActivityJobData } from 'src/modules/enso/lead-pipeline/jobs/lead-pipeline-job.types';
import { ResolveOpportunityFromActivityJob } from 'src/modules/enso/lead-pipeline/jobs/resolve-opportunity-from-activity.job';
import {
  deserializeCallEvent,
  type IngestCallEventJobData,
} from 'src/modules/enso/telephony/jobs/telephony-job.types';
import { CallIdentityService } from 'src/modules/enso/telephony/services/call-identity.service';
import { CallIngestService } from 'src/modules/enso/telephony/services/call-ingest.service';

// Telephony intake runs off the queue rather than inline in the controller: the
// PBX and Roistat both expect a fast ack, and a slow response to the PBX sits in
// the path of a live call. The controller validates and enqueues; all database
// work happens here so a retry is cheap and independent.
@Processor(MessageQueue.ensoTelephonyQueue)
export class IngestCallEventJob {
  private readonly logger = new Logger(IngestCallEventJob.name);

  constructor(
    private readonly callIngestService: CallIngestService,
    private readonly callIdentityService: CallIdentityService,
    @InjectMessageQueue(MessageQueue.ensoLeadPipelineQueue)
    private readonly leadPipelineQueueService: MessageQueueService,
  ) {}

  @Process(IngestCallEventJob.name)
  async handle(data: IngestCallEventJobData): Promise<void> {
    const { workspaceId, event: serialized } = data;
    const event = deserializeCallEvent(serialized);

    const ingested = await this.callIngestService.ingest(workspaceId, event);

    if (!isDefined(ingested)) {
      this.logger.warn(
        `Telephony ingest produced no activity for ${event.externalId}`,
      );

      return;
    }

    if (!ingested.needsIdentity) {
      return;
    }

    const personId = isDefined(ingested.callerE164)
      ? await this.callIdentityService.resolvePersonId(
          workspaceId,
          ingested.callerE164,
        )
      : undefined;

    const resolved = await this.callIdentityService.resolveEntryPoint(
      workspaceId,
      {
        roistatProjectCode: event.attribution?.projectCode,
        roistatScenario: event.roistatScenario,
        pbxGroupName: event.answeredByGroup,
        calleeDid: event.calleeDid,
      },
    );

    const shouldResolveOpportunity = await this.callIngestService.linkIdentity(
      workspaceId,
      ingested.activityId,
      { personId, projectId: resolved?.projectId },
    );

    if (!shouldResolveOpportunity) {
      // A call with no resolvable project still lands as a visible activity; it
      // just cannot become a deal, because the pipeline keys dedup and routing
      // on (person, project). Most untracked-DID calls end up here until the
      // PBX-department / DID project map is filled in.
      this.logger.log(
        `Activity ${ingested.activityId} not ready for opportunity resolution (person=${isDefined(personId)}, project=${isDefined(resolved)})`,
      );

      return;
    }

    // Two entry points can share a project but belong to different teams —
    // TRIUMF Support and TRIUMF Sales are both ENS2101. A support call is a real
    // call worth logging, but it is not a sales lead, so it stops here rather
    // than entering dedup and routing.
    if (resolved?.entryPoint.lead === false) {
      this.logger.log(
        `Activity ${ingested.activityId} is not lead-generating (queue=${resolved.entryPoint.queue ?? 'default'})`,
      );

      return;
    }

    // Raw-ORM writes bypass the createOne POST hook that normally starts the
    // pipeline, so the handoff is explicit here.
    await this.leadPipelineQueueService.add<ResolveOpportunityFromActivityJobData>(
      ResolveOpportunityFromActivityJob.name,
      { workspaceId, activityId: ingested.activityId },
      // One resolution attempt per activity; the job itself is idempotent on
      // opportunityId, but this keeps redelivered pushes from queueing repeats.
      { id: `enso-telephony-resolve:${ingested.activityId}` },
    );

    this.logger.log(
      `Enqueued opportunity resolution for activity ${ingested.activityId}`,
    );
  }
}
