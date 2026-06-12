import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type ManagerNotifyJobData } from 'src/modules/enso/lead-pipeline/jobs/lead-pipeline-job.types';
import { ManagerNotificationService } from 'src/modules/enso/lead-pipeline/services/manager-notification.service';

// Worker dispatch for the Phase 2 manager notifications. Kept off the request
// path (listeners only enqueue) so a slow/failed Google Chat post never blocks
// the originating mutation; ManagerNotificationService is best-effort anyway.
@Processor(MessageQueue.ensoLeadPipelineQueue)
export class ManagerNotifyJob {
  constructor(
    private readonly managerNotificationService: ManagerNotificationService,
  ) {}

  @Process(ManagerNotifyJob.name)
  async handle(data: ManagerNotifyJobData): Promise<void> {
    const authContext = buildSystemAuthContext(data.workspaceId);

    switch (data.kind) {
      case 'lost_reassigned':
        await this.managerNotificationService.notifyLostReassigned(
          authContext,
          {
            opportunityId: data.opportunityId,
            managerId: data.managerId,
          },
        );
        break;
      case 'deal_state_changed':
        await this.managerNotificationService.notifyDealStateChanged(
          authContext,
          {
            opportunityId: data.opportunityId,
            managerId: data.managerId,
            transition: data.transition,
            newStage: data.newStage,
          },
        );
        break;
      case 'task_assigned':
        await this.managerNotificationService.notifyTaskAssigned(authContext, {
          taskId: data.taskId,
          managerId: data.managerId,
        });
        break;
      case 'task_due':
        await this.managerNotificationService.notifyTaskDue(authContext, {
          taskId: data.taskId,
          managerId: data.managerId,
        });
        break;
      case 'consent_changed':
        await this.managerNotificationService.notifyConsentChange(authContext, {
          personId: data.personId,
          projectId: data.projectId,
          managerId: data.managerId,
        });
        break;
    }
  }
}
