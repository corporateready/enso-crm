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
import { ANSWERED_CALL_STATUSES } from 'src/modules/enso/telephony/telephony.constants';
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

    // Resolve the caller only when the row still lacks identity — but never
    // return early on that. One call arrives as several pushes: an earlier
    // non-terminal event fills person+project, and the later terminal one is the
    // only push that can decide the deal's stage. Short-circuiting here meant no
    // call ever produced a deal.
    const personId =
      ingested.needsIdentity && isDefined(ingested.callerE164)
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
        `Activity ${ingested.activityId} not ready for opportunity resolution (person=${isDefined(personId)}, project=${isDefined(resolved?.projectId)})`,
      );

      return;
    }

    // Hold opportunity resolution until the call's outcome is known. The stage a
    // deal opens in depends on whether anyone picked up, and a deal created at
    // ring time would be stuck in ROUTING before we could know. The activity is
    // already visible from the first signal, so nothing is hidden meanwhile.
    if (!event.isTerminal) {
      return;
    }

    const answered = isDefined(event.callStatus)
      ? ANSWERED_CALL_STATUSES.includes(event.callStatus)
      : false;

    // An answered inbound call is two-way engagement, so it opens CONNECTED and
    // never routes. An unanswered one is exactly what ROUTING is for.
    const alreadyConnected = answered
      ? {
          ownerMemberId:
            await this.callIdentityService.resolveAnsweredOwnerMemberId(
              workspaceId,
              event.answeredByLogin,
            ),
        }
      : undefined;

    // Raw-ORM writes bypass the createOne POST hook that normally starts the
    // pipeline, so the handoff is explicit here.
    await this.leadPipelineQueueService.add<ResolveOpportunityFromActivityJobData>(
      ResolveOpportunityFromActivityJob.name,
      {
        workspaceId,
        activityId: ingested.activityId,
        ...(isDefined(alreadyConnected) ? { alreadyConnected } : {}),
      },
      // One resolution attempt per activity; the job itself is idempotent on
      // opportunityId, but this keeps redelivered pushes from queueing repeats.
      { id: `enso-telephony-resolve:${ingested.activityId}` },
    );

    this.logger.log(
      `Enqueued opportunity resolution for activity ${ingested.activityId} (${answered ? 'answered → CONNECTED' : 'unanswered → ROUTING'})`,
    );
  }
}
