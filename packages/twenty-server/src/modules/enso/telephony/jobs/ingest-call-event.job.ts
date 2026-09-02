import { Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { type ResolveOpportunityFromActivityJobData } from 'src/modules/enso/lead-pipeline/jobs/lead-pipeline-job.types';
import { ResolveOpportunityFromActivityJob } from 'src/modules/enso/lead-pipeline/jobs/resolve-opportunity-from-activity.job';
import { ArchiveCallRecordingJob } from 'src/modules/enso/telephony/jobs/archive-call-recording.job';
import {
  type ArchiveCallRecordingJobData,
  deserializeCallEvent,
  type IngestCallEventJobData,
} from 'src/modules/enso/telephony/jobs/telephony-job.types';
import { CallIdentityService } from 'src/modules/enso/telephony/services/call-identity.service';
import { OutboundCallIngestService } from 'src/modules/enso/telephony/services/outbound-call-ingest.service';
import { PbxNumberService } from 'src/modules/enso/telephony/services/pbx-number.service';
import {
  ANSWERED_CALL_STATUSES,
  ARCHIVE_RECORDINGS,
  RECORDING_INITIAL_DELAY_MS,
} from 'src/modules/enso/telephony/telephony.constants';
import { CallIngestService } from 'src/modules/enso/telephony/services/call-ingest.service';
import { type NormalizedCallEvent } from 'src/modules/enso/telephony/types/telephony.types';

// Telephony intake runs off the queue rather than inline in the controller: the
// PBX and Roistat both expect a fast ack, and a slow response to the PBX sits in
// the path of a live call. The controller validates and enqueues; all database
// work happens here so a retry is cheap and independent.
@Processor(MessageQueue.ensoTelephonyQueue)
export class IngestCallEventJob {
  private readonly logger = new Logger(IngestCallEventJob.name);

  constructor(
    private readonly callIngestService: CallIngestService,
    private readonly outboundCallIngestService: OutboundCallIngestService,
    private readonly callIdentityService: CallIdentityService,
    private readonly pbxNumberService: PbxNumberService,
    @InjectMessageQueue(MessageQueue.ensoLeadPipelineQueue)
    private readonly leadPipelineQueueService: MessageQueueService,
    @InjectMessageQueue(MessageQueue.ensoTelephonyQueue)
    private readonly telephonyQueueService: MessageQueueService,
  ) {}

  @Process(IngestCallEventJob.name)
  async handle(data: IngestCallEventJobData): Promise<void> {
    const { workspaceId, event: serialized } = data;
    const event = deserializeCallEvent(serialized);

    // A manager dialling out is a touch on a contact, not a new lead, so it
    // takes a completely separate path: an outboundActivity, no dedup, no
    // routing, no deal creation.
    if (event.direction === 'out') {
      await this.handleOutbound(workspaceId, event);

      return;
    }

    const ingested = await this.callIngestService.ingest(workspaceId, event);

    if (!isDefined(ingested)) {
      this.logger.warn(
        `Telephony ingest produced no activity for ${event.externalId}`,
      );

      return;
    }

    await this.enqueueRecordingArchive(workspaceId, event, {
      objectNameSingular: 'inboundActivity',
      activityId: ingested.activityId,
    });

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

    // Teach the dial plan from this push. `event` carries both the dialled
    // number and the department, which is the only place the two appear
    // together — a `contact` push has the number but no department.
    await this.pbxNumberService.learn(
      workspaceId,
      event.calleeDid,
      event.answeredByGroup,
    );

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

    // Hold opportunity resolution until the call's outcome is actually known.
    // Being terminal is not enough: `event COMPLETED` ends the call but carries
    // no status, so acting on it opened every answered call in ROUTING — the
    // stage for a call nobody took. `history` (and `event CANCELLED`, which does
    // imply ABANDONED) are the pushes that can decide, so we wait for one.
    if (!event.isTerminal || !isDefined(event.callStatus)) {
      return;
    }

    const answered = ANSWERED_CALL_STATUSES.includes(event.callStatus);

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

  // Outbound: log the touch and stop. Whatever placed the call — the CRM's own
  // button, the Moldcell app, a desk phone — the PBX reports it the same way, so
  // this one path captures all of them.
  private async handleOutbound(
    workspaceId: string,
    event: NormalizedCallEvent,
  ): Promise<void> {
    // The contact is looked up, never created: we called a number, which says
    // nothing about whether that number belongs in the CRM. An unknown number
    // still logs the call, just without a person link.
    const person = isDefined(event.callerE164)
      ? await this.callIdentityService.lookupPersonByPhone(
          workspaceId,
          event.callerE164,
        )
      : undefined;

    // No fallback owner here, unlike the inbound leg: filing one manager's call
    // under another's name because a PBX login is unmapped would be a plainly
    // wrong record, and an unattributed call is still a true one.
    const performedById =
      await this.callIdentityService.resolveMemberIdByPbxLogin(
        workspaceId,
        event.answeredByLogin,
      );

    const ingested = await this.outboundCallIngestService.ingest(
      workspaceId,
      event,
      {
        ...(isDefined(person) ? { personId: person.id } : {}),
        ...(isDefined(performedById) ? { performedById } : {}),
      },
    );

    if (!isDefined(ingested)) {
      this.logger.warn(
        `Outbound ingest produced no activity for ${event.externalId}`,
      );

      return;
    }

    await this.enqueueRecordingArchive(workspaceId, event, {
      objectNameSingular: 'outboundActivity',
      activityId: ingested.activityId,
    });

    // Only the push that FIRST gave the row its outcome finalizes it. Gating on
    // "is this the history push" is not enough — a redelivered history push
    // would write a second timeline line for the same call.
    if (!ingested.becameTerminal) {
      return;
    }

    const opportunityId = isDefined(person)
      ? await this.callIdentityService.resolveSingleOpenOpportunityId(
          workspaceId,
          person.id,
        )
      : undefined;

    await this.outboundCallIngestService.finalize(
      workspaceId,
      ingested.activityId,
      {
        ...(isDefined(opportunityId) ? { opportunityId } : {}),
        ...(isDefined(person) ? { personId: person.id } : {}),
        ...(isDefined(performedById) ? { performedById } : {}),
        ...(isDefined(event.durationS) ? { durationS: event.durationS } : {}),
        answered:
          isDefined(event.callStatus) &&
          ANSWERED_CALL_STATUSES.includes(event.callStatus),
      },
    );
  }

  private async enqueueRecordingArchive(
    workspaceId: string,
    event: NormalizedCallEvent,
    target: {
      objectNameSingular: 'inboundActivity' | 'outboundActivity';
      activityId: string;
    },
  ): Promise<void> {
    if (!ARCHIVE_RECORDINGS || !isDefined(event.recordingUrl)) {
      return;
    }

    await this.telephonyQueueService.add<ArchiveCallRecordingJobData>(
      ArchiveCallRecordingJob.name,
      {
        workspaceId,
        recordingUrl: event.recordingUrl,
        ...target,
        ...(isDefined(event.occurredAt)
          ? { occurredAtIso: event.occurredAt.toISOString() }
          : {}),
        attempt: 1,
      },
      {
        id: `enso-telephony-recording:${target.activityId}:1`,
        // The PBX finishes writing the audio after the call ends, so asking for
        // it the instant `history` lands is a guaranteed miss on short calls.
        delay: RECORDING_INITIAL_DELAY_MS,
      },
    );
  }
}
