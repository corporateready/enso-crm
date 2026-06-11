import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { Repository } from 'typeorm';

import { SentryCronMonitor } from 'src/engine/core-modules/cron/sentry-cron-monitor.decorator';
import { ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import {
  CHANNEL_SOCIAL,
  CHANNELS_WITH_LIVE_SEQUENCE,
  CLOSED_LOST_STAGE,
  CLOSED_STAGES,
  CONNECTED_STAGE,
  DEFAULT_VARIANT,
  FIRST_TOUCH_STEP_KEY,
  FIRST_TOUCH_TITLE_PREFIX,
  INBOUND_KIND_TO_CHANNEL,
  INBOUND_SOCIAL_MESSAGE_KIND,
  LEAD_CLAIMED_STAGE,
  SEQUENCE_PIPELINE_STATE_ACTIVE,
  SEQUENCE_RUN_END_REASON_ADVANCED,
  SEQUENCE_RUN_END_REASON_CLOSED,
  SEQUENCE_RUN_END_REASON_SUPERSEDED,
  SEQUENCING_SCANNER_CRON_PATTERN,
  SOCIAL_FIRST_CONTACT_CHANNEL,
  SOCIAL_LEAD_CLAIMED_CLOSE_AFTER_STALL_MS,
  SOCIAL_LEAD_CLAIMED_FOLLOWUPS,
  SOCIAL_LEAD_CLAIMED_STALL_AFTER_MS,
  STALLED_PIPELINE_STATE,
  UNREACHABLE_LOST_REASON,
} from 'src/modules/enso/sequencing/sequencing.constants';

// Runs every minute. For each active workspace, sweeps open sequence runs
// (endReason IS NULL) and acts on the deal's *current* state: end runs whose deal
// advanced/closed, create due follow-up tasks, flip to stalled, auto-close after grace.
@Processor(MessageQueue.cronQueue)
export class SequencingScannerCronJob {
  private readonly logger = new Logger(SequencingScannerCronJob.name);

  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly exceptionHandlerService: ExceptionHandlerService,
  ) {}

  @Process(SequencingScannerCronJob.name)
  @SentryCronMonitor(
    SequencingScannerCronJob.name,
    SEQUENCING_SCANNER_CRON_PATTERN,
  )
  async handle(): Promise<void> {
    const workspaces = await this.workspaceRepository.find({
      where: { activationStatus: WorkspaceActivationStatus.ACTIVE },
    });
    this.logger.log(`scanner: ${workspaces.length} active workspace(s)`);

    for (const workspace of workspaces) {
      try {
        await this.scanWorkspace(workspace.id);
      } catch (error) {
        this.logger.error(
          `scan failed for workspace ${workspace.id}: ${(error as Error).message}`,
        );
        this.exceptionHandlerService.captureExceptions([error as Error]);
      }
    }
  }

  private async scanWorkspace(workspaceId: string): Promise<void> {
    const systemAuthContext = buildSystemAuthContext(workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const runRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'sequenceRun',
          { shouldBypassPermissionChecks: true },
        );
      const opportunityRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'opportunity',
          { shouldBypassPermissionChecks: true },
        );
      const taskRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'task',
          { shouldBypassPermissionChecks: true },
        );
      const inboundActivityRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'inboundActivity',
          { shouldBypassPermissionChecks: true },
        );
      const taskTargetRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'taskTarget',
          { shouldBypassPermissionChecks: true },
        );
      const sequenceRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'sequence',
          { shouldBypassPermissionChecks: true },
        );

      const now = Date.now();

      // Enrollment pass: enroll newly-claimed social deals that have no open
      // run yet (enrollment moved here from the first-touch workflow so the
      // variant can be picked by weight and the channel gated up front).
      // TwentyORM doesn't reliably support TypeORM operators (IsNull) in where —
      // fetch and filter in JS (run volume is low).
      const allRuns = await runRepository.find();
      const openRunOpportunityIds = new Set(
        allRuns
          .filter((run) => !isDefined(run.endReason))
          .map((run) => run.opportunityId),
      );
      const activeSequences = (await sequenceRepository.find()).filter(
        (sequence) => sequence.isActive === true,
      );
      // TwentyORM `where` rejects equality on SELECT columns ("Data validation
      // error") just like it rejects operators — fetch and filter stage in JS.
      const allOpportunities = await opportunityRepository.find();
      const leadClaimedOpportunities = allOpportunities.filter(
        (opportunity) => opportunity.stage === LEAD_CLAIMED_STAGE,
      );

      let enrolledCount = 0;

      for (const opportunity of leadClaimedOpportunities) {
        if (openRunOpportunityIds.has(opportunity.id)) {
          continue;
        }

        const inboundActivities = await inboundActivityRepository.find({
          where: { opportunityId: opportunity.id },
        });
        const channel = this.resolveDealChannel(inboundActivities);

        if (!CHANNELS_WITH_LIVE_SEQUENCE.includes(channel)) {
          continue;
        }

        const sequence = this.pickWeightedSequence(activeSequences, channel);

        if (!isDefined(sequence)) {
          continue;
        }

        const variant = sequence.variant ?? DEFAULT_VARIANT;
        const newRun = await runRepository.save({
          opportunityId: opportunity.id,
          sequenceId: sequence.id,
          variant,
          enrolledAt: new Date(),
        });
        const firstTouchTask = await taskRepository.save({
          title: `${FIRST_TOUCH_TITLE_PREFIX} - ${opportunity.name ?? 'lead'}`,
          channel,
          stepKey: FIRST_TOUCH_STEP_KEY,
          isAutoCreated: true,
          sequenceRunId: newRun.id,
          variant,
          assigneeId: opportunity.ownerId ?? null,
        });

        await this.pinTasksToDeal(
          taskTargetRepository,
          [firstTouchTask],
          opportunity,
        );
        openRunOpportunityIds.add(opportunity.id);
        enrolledCount += 1;
        this.logger.log(
          `scanner: enrolled opportunity ${opportunity.id} (channel ${channel}, variant ${variant})`,
        );
      }

      // Re-fetch only if we enrolled, so the cadence pass sees the new runs.
      const runsForCadence = enrolledCount > 0 ? await runRepository.find() : allRuns;
      const openRuns = runsForCadence.filter((run) => !isDefined(run.endReason));
      this.logger.log(
        `scanner: workspace ${workspaceId} — enrolled ${enrolledCount}, ${openRuns.length} open run(s)`,
      );

      for (const run of openRuns) {
        const opportunity = await opportunityRepository.findOne({
          where: { id: run.opportunityId },
        });

        if (!isDefined(opportunity)) {
          continue;
        }

        // Deal left Lead Claimed -> end the run (safety net; the reply observer
        // advances on inbound, this catches everything else).
        if (opportunity.stage !== LEAD_CLAIMED_STAGE) {
          if (CLOSED_STAGES.includes(opportunity.stage)) {
            await runRepository.update(run.id, {
              endReason: SEQUENCE_RUN_END_REASON_CLOSED,
              endedAt: new Date(),
            });
          } else {
            await runRepository.update(run.id, {
              advanced: true,
              advancedToStage: opportunity.stage,
              advancedAt: new Date(),
              endReason: SEQUENCE_RUN_END_REASON_ADVANCED,
              endedAt: new Date(),
            });
          }
          continue;
        }

        const enrolledAt = run.enrolledAt ?? run.createdAt;
        const enrolledAtMs = new Date(enrolledAt).getTime();
        const elapsedMs = now - enrolledAtMs;

        const runTasks = await taskRepository.find({
          where: { sequenceRunId: run.id },
        });

        // Pin the run's tasks to the deal (and contact) so they show on the
        // record Tasks tab. Workflows can't create join objects, so the scanner
        // backfills taskTargets — idempotently, covering the first-touch task
        // too. Done before the reply/gate branches so every path is covered.
        await this.pinTasksToDeal(taskTargetRepository, runTasks, opportunity);

        // Reply observer: an inbound social message that landed AFTER enrollment
        // means the lead answered the manager -> two-way contact established.
        // (The pre-claim first message predates enrollment, so it can't match.)
        // Advance Lead Claimed -> Connected; the run ends as advanced.
        const inboundActivities = await inboundActivityRepository.find({
          where: { opportunityId: opportunity.id },
        });
        const hasReplyAfterEnrollment = inboundActivities.some((activity) => {
          if (activity.kind !== INBOUND_SOCIAL_MESSAGE_KIND) {
            return false;
          }
          const occurredAt = activity.occurredAt ?? activity.createdAt;

          return (
            isDefined(occurredAt) &&
            new Date(occurredAt).getTime() > enrolledAtMs
          );
        });

        if (hasReplyAfterEnrollment) {
          await opportunityRepository.update(opportunity.id, {
            stage: CONNECTED_STAGE,
            ...(isDefined(opportunity.firstContactAt)
              ? {}
              : {
                  firstContactAt: new Date(),
                  firstContactChannel: SOCIAL_FIRST_CONTACT_CHANNEL,
                }),
          });
          await runRepository.update(run.id, {
            advanced: true,
            advancedToStage: CONNECTED_STAGE,
            advancedAt: new Date(),
            endReason: SEQUENCE_RUN_END_REASON_ADVANCED,
            endedAt: new Date(),
          });
          this.logger.log(
            `scanner: run ${run.id} -> CONNECTED (inbound reply for opportunity ${opportunity.id})`,
          );
          continue;
        }

        // Channel gating: only social has a live sequence today. Derive the
        // deal's origin channel from its earliest inbound activity; for any
        // other channel, end the run (no cadence) until that sequence exists.
        const channel = this.resolveDealChannel(inboundActivities);

        if (!CHANNELS_WITH_LIVE_SEQUENCE.includes(channel)) {
          await runRepository.update(run.id, {
            endReason: SEQUENCE_RUN_END_REASON_SUPERSEDED,
            endedAt: new Date(),
          });
          this.logger.log(
            `scanner: run ${run.id} superseded — no live sequence for channel ${channel} (opportunity ${opportunity.id})`,
          );
          continue;
        }

        // Due follow-up tasks (idempotent: skip if the step's task already exists).
        const createdTasks = [];

        for (const followUp of SOCIAL_LEAD_CLAIMED_FOLLOWUPS) {
          if (elapsedMs < followUp.afterMs) {
            continue;
          }

          const alreadyCreated = runTasks.some(
            (task) => task.stepKey === followUp.stepKey,
          );

          if (!alreadyCreated) {
            const createdTask = await taskRepository.save({
              title: `Follow-up - ${opportunity.name ?? 'lead'}`,
              channel,
              stepKey: followUp.stepKey,
              isAutoCreated: true,
              sequenceRunId: run.id,
              variant: run.variant,
              assigneeId: opportunity.ownerId ?? null,
            });

            createdTasks.push(createdTask);
          }
        }

        // Pin freshly created follow-ups to the deal + contact.
        await this.pinTasksToDeal(
          taskTargetRepository,
          createdTasks,
          opportunity,
        );

        // Stall once the cadence is exhausted.
        if (
          elapsedMs >= SOCIAL_LEAD_CLAIMED_STALL_AFTER_MS &&
          opportunity.pipelineState !== STALLED_PIPELINE_STATE
        ) {
          await opportunityRepository.update(opportunity.id, {
            pipelineState: STALLED_PIPELINE_STATE,
          });
        }

        // Auto-close as Unreachable after the grace window.
        if (
          elapsedMs >=
          SOCIAL_LEAD_CLAIMED_STALL_AFTER_MS +
            SOCIAL_LEAD_CLAIMED_CLOSE_AFTER_STALL_MS
        ) {
          await opportunityRepository.update(opportunity.id, {
            stage: CLOSED_LOST_STAGE,
            lostReason: UNREACHABLE_LOST_REASON,
          });
          await runRepository.update(run.id, {
            endReason: SEQUENCE_RUN_END_REASON_CLOSED,
            endedAt: new Date(),
          });
        }
      }
    }, systemAuthContext);
  }

  // Link tasks to their deal (and contact) via taskTarget join rows so they
  // appear on the record Tasks tab. Idempotent: skips links that already exist.
  private async pinTasksToDeal(
    taskTargetRepository: any,
    tasks: { id: string }[],
    opportunity: { id: string; pointOfContactId?: string | null },
  ): Promise<void> {
    if (tasks.length === 0) {
      return;
    }

    const existingDealTargets = await taskTargetRepository.find({
      where: { targetOpportunityId: opportunity.id },
    });
    const dealLinkedTaskIds = new Set(
      existingDealTargets.map((target: { taskId: string }) => target.taskId),
    );

    const personId = opportunity.pointOfContactId;
    const existingPersonTargets = isDefined(personId)
      ? await taskTargetRepository.find({ where: { targetPersonId: personId } })
      : [];
    const personLinkedTaskIds = new Set(
      existingPersonTargets.map((target: { taskId: string }) => target.taskId),
    );

    for (const task of tasks) {
      if (!dealLinkedTaskIds.has(task.id)) {
        await taskTargetRepository.save({
          taskId: task.id,
          targetOpportunityId: opportunity.id,
        });
      }

      if (isDefined(personId) && !personLinkedTaskIds.has(task.id)) {
        await taskTargetRepository.save({
          taskId: task.id,
          targetPersonId: personId,
        });
      }
    }
  }

  // Weighted-random pick among active sequences for a deal's slot
  // (channel x Lead Claimed x Active). Returns undefined if none match.
  private pickWeightedSequence(
    sequences: {
      id: string;
      variant?: string | null;
      weight?: number | null;
      channel?: string;
      stage?: string;
      pipelineState?: string;
    }[],
    channel: string,
  ):
    | {
        id: string;
        variant?: string | null;
        weight?: number | null;
      }
    | undefined {
    const candidates = sequences.filter(
      (sequence) =>
        sequence.channel === channel &&
        sequence.stage === LEAD_CLAIMED_STAGE &&
        sequence.pipelineState === SEQUENCE_PIPELINE_STATE_ACTIVE,
    );

    if (candidates.length === 0) {
      return undefined;
    }

    const weightOf = (sequence: { weight?: number | null }): number =>
      isDefined(sequence.weight) && sequence.weight > 0 ? sequence.weight : 0;
    const totalWeight = candidates.reduce(
      (sum, sequence) => sum + weightOf(sequence),
      0,
    );

    if (totalWeight <= 0) {
      return candidates[0];
    }

    let roll = Math.random() * totalWeight;

    for (const sequence of candidates) {
      roll -= weightOf(sequence);

      if (roll < 0) {
        return sequence;
      }
    }

    return candidates[candidates.length - 1];
  }

  // Map a deal's earliest inbound activity to its origin channel; default to
  // social when there's no recognizable inbound origin (e.g. manual deals).
  private resolveDealChannel(inboundActivities: { kind?: string; occurredAt?: Date | string; createdAt?: Date | string }[]): string {
    const sortedByOccurrence = [...inboundActivities]
      .filter((activity) => isDefined(activity.kind))
      .sort((a, b) => {
        const aTime = new Date(a.occurredAt ?? a.createdAt ?? 0).getTime();
        const bTime = new Date(b.occurredAt ?? b.createdAt ?? 0).getTime();

        return aTime - bTime;
      });

    for (const activity of sortedByOccurrence) {
      const channel = INBOUND_KIND_TO_CHANNEL[activity.kind as string];

      if (isDefined(channel)) {
        return channel;
      }
    }

    return CHANNEL_SOCIAL;
  }
}
