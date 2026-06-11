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
  CLOSED_LOST_STAGE,
  CLOSED_STAGES,
  LEAD_CLAIMED_STAGE,
  SEQUENCE_RUN_END_REASON_ADVANCED,
  SEQUENCE_RUN_END_REASON_CLOSED,
  SEQUENCING_SCANNER_CRON_PATTERN,
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

      // TwentyORM doesn't reliably support TypeORM operators (IsNull) in where —
      // fetch and filter in JS (run volume is low).
      const allRuns = await runRepository.find();
      const openRuns = allRuns.filter((run) => !isDefined(run.endReason));
      this.logger.log(
        `scanner: workspace ${workspaceId} — ${openRuns.length} open run(s)`,
      );
      const now = Date.now();

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
        const elapsedMs = now - new Date(enrolledAt).getTime();

        const runTasks = await taskRepository.find({
          where: { sequenceRunId: run.id },
        });

        // Due follow-up tasks (idempotent: skip if the step's task already exists).
        for (const followUp of SOCIAL_LEAD_CLAIMED_FOLLOWUPS) {
          if (elapsedMs < followUp.afterMs) {
            continue;
          }

          const alreadyCreated = runTasks.some(
            (task) => task.stepKey === followUp.stepKey,
          );

          if (!alreadyCreated) {
            await taskRepository.save({
              title: `Follow-up - ${opportunity.name ?? 'lead'}`,
              channel: 'SOCIAL',
              stepKey: followUp.stepKey,
              isAutoCreated: true,
              sequenceRunId: run.id,
              assigneeId: opportunity.ownerId ?? null,
            });
          }
        }

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
}
