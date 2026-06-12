import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { Between, Repository } from 'typeorm';

import { SentryCronMonitor } from 'src/engine/core-modules/cron/sentry-cron-monitor.decorator';
import { ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { KeyValuePairType } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { KeyValuePairService } from 'src/engine/core-modules/key-value-pair/key-value-pair.service';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type ManagerNotifyJobData } from 'src/modules/enso/lead-pipeline/jobs/lead-pipeline-job.types';
import { ManagerNotifyJob } from 'src/modules/enso/lead-pipeline/jobs/manager-notify.job';
import {
  TASK_DUE_LAST_SCAN_KEY,
  TASK_DUE_SCANNER_CRON_PATTERN,
} from 'src/modules/enso/notifications/notifications.constants';

// Runs every minute. For each active workspace, finds tasks whose dueAt has
// crossed since the last scan and notifies the assignee. A per-workspace
// watermark (keyValuePair) makes each task notify exactly once and survives
// missed ticks; the first run just seeds the watermark so it never floods.
@Processor(MessageQueue.cronQueue)
export class TaskDueScannerCronJob {
  private readonly logger = new Logger(TaskDueScannerCronJob.name);

  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly keyValuePairService: KeyValuePairService,
    private readonly exceptionHandlerService: ExceptionHandlerService,
    @InjectMessageQueue(MessageQueue.ensoLeadPipelineQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {}

  @Process(TaskDueScannerCronJob.name)
  @SentryCronMonitor(TaskDueScannerCronJob.name, TASK_DUE_SCANNER_CRON_PATTERN)
  async handle(): Promise<void> {
    const workspaces = await this.workspaceRepository.find({
      where: { activationStatus: WorkspaceActivationStatus.ACTIVE },
    });

    for (const workspace of workspaces) {
      try {
        await this.scanWorkspace(workspace.id);
      } catch (error) {
        this.logger.error(
          `task-due scan failed for workspace ${workspace.id}: ${(error as Error).message}`,
        );
        this.exceptionHandlerService.captureExceptions([error as Error]);
      }
    }
  }

  private async scanWorkspace(workspaceId: string): Promise<void> {
    const now = new Date();
    const lastScan = await this.getWatermark(workspaceId);

    // First run for this workspace: seed the watermark, notify nothing.
    if (!isDefined(lastScan)) {
      await this.setWatermark(workspaceId, now);

      return;
    }

    const systemAuthContext = buildSystemAuthContext(workspaceId);

    const dueTasks =
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const taskRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'task',
              { shouldBypassPermissionChecks: true },
            );

          return taskRepository.find({
            where: { dueAt: Between(lastScan, now) },
          });
        },
        systemAuthContext,
      );

    for (const task of dueTasks) {
      if (!isDefined(task.assigneeId) || task.status === 'DONE') {
        continue;
      }

      const data: ManagerNotifyJobData = {
        workspaceId,
        kind: 'task_due',
        taskId: task.id,
        managerId: task.assigneeId,
      };

      await this.messageQueueService.add<ManagerNotifyJobData>(
        ManagerNotifyJob.name,
        data,
      );
    }

    await this.setWatermark(workspaceId, now);
  }

  private async getWatermark(workspaceId: string): Promise<Date | undefined> {
    const rows = await this.keyValuePairService.get({
      type: KeyValuePairType.USER_VARIABLE,
      userId: null,
      workspaceId,
      key: TASK_DUE_LAST_SCAN_KEY,
    });

    const raw = rows?.[0]?.value;

    if (typeof raw !== 'string') {
      return undefined;
    }

    const parsed = new Date(raw);

    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private async setWatermark(workspaceId: string, at: Date): Promise<void> {
    await this.keyValuePairService.set({
      userId: null,
      workspaceId,
      key: TASK_DUE_LAST_SCAN_KEY,
      value: at.toISOString(),
      type: KeyValuePairType.USER_VARIABLE,
    });
  }
}
