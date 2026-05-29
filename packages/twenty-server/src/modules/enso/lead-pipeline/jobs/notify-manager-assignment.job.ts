import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type NotifyManagerAssignmentJobData } from 'src/modules/enso/lead-pipeline/jobs/lead-pipeline-job.types';
import { CLAIM_WINDOW_MS } from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';
import { ManagerNotificationService } from 'src/modules/enso/lead-pipeline/services/manager-notification.service';

// Stage 3: tell the assigned manager (Google Chat) they have a lead to claim.
// Kept separate from routing so notification channels can evolve independently
// (in-app / Knock later) and a notification failure never blocks the timer.
@Processor(MessageQueue.ensoLeadPipelineQueue)
export class NotifyManagerAssignmentJob {
  constructor(
    private readonly managerNotificationService: ManagerNotificationService,
  ) {}

  @Process(NotifyManagerAssignmentJob.name)
  async handle(data: NotifyManagerAssignmentJobData): Promise<void> {
    const { workspaceId, opportunityId, managerId } = data;

    const authContext = buildSystemAuthContext(workspaceId);

    await this.managerNotificationService.notifyAssignment(authContext, {
      opportunityId,
      managerId,
      claimWindowMinutes: Math.round(CLAIM_WINDOW_MS / 60_000),
    });
  }
}
