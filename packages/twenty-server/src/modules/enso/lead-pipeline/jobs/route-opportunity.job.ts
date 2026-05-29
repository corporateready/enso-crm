import { Logger } from '@nestjs/common';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { ClaimCheckJob } from 'src/modules/enso/lead-pipeline/jobs/claim-check.job';
import {
  type ClaimCheckJobData,
  type NotifyManagerAssignmentJobData,
  type RouteOpportunityJobData,
} from 'src/modules/enso/lead-pipeline/jobs/lead-pipeline-job.types';
import { NotifyManagerAssignmentJob } from 'src/modules/enso/lead-pipeline/jobs/notify-manager-assignment.job';
import { CLAIM_WINDOW_MS } from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';
import { ManagerNotificationService } from 'src/modules/enso/lead-pipeline/services/manager-notification.service';
import { OpportunityRoutingService } from 'src/modules/enso/lead-pipeline/services/opportunity-routing.service';

// Stage 2: assign a manager to an opportunity in ROUTING. On success notify the
// manager and open a claim window (a delayed claim-check). If routing is
// exhausted, escalate to ops and stall the deal.
@Processor(MessageQueue.ensoLeadPipelineQueue)
export class RouteOpportunityJob {
  private readonly logger = new Logger(RouteOpportunityJob.name);

  constructor(
    private readonly opportunityRoutingService: OpportunityRoutingService,
    private readonly managerNotificationService: ManagerNotificationService,
    @InjectMessageQueue(MessageQueue.ensoLeadPipelineQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {}

  @Process(RouteOpportunityJob.name)
  async handle(data: RouteOpportunityJobData): Promise<void> {
    const { workspaceId, opportunityId, excludedManagerIds, attempt } = data;

    const authContext = buildSystemAuthContext(workspaceId);

    const result = await this.opportunityRoutingService.routeOpportunity(
      authContext,
      opportunityId,
      excludedManagerIds,
      attempt,
    );

    if (result.status === 'already_claimed' || result.status === 'not_found') {
      return;
    }

    if (result.status === 'no_candidates') {
      await this.opportunityRoutingService.markStalled(
        authContext,
        opportunityId,
      );
      await this.managerNotificationService.notifyEscalation(authContext, {
        opportunityId,
        reason: 'No available managers to route to.',
        attempts: attempt,
      });

      return;
    }

    // Assigned. Notify the manager (separate job) and open the claim window.
    await this.messageQueueService.add<NotifyManagerAssignmentJobData>(
      NotifyManagerAssignmentJob.name,
      { workspaceId, opportunityId, managerId: result.managerId },
    );

    await this.messageQueueService.add<ClaimCheckJobData>(
      ClaimCheckJob.name,
      {
        workspaceId,
        opportunityId,
        attempt,
        // The just-assigned manager is excluded from the next reroute.
        excludedManagerIds: [...excludedManagerIds, result.managerId],
      },
      {
        delay: CLAIM_WINDOW_MS,
        // Idempotent: one claim-check per (opportunity, attempt).
        id: `enso-claim-check:${opportunityId}:${attempt}`,
      },
    );
  }
}
