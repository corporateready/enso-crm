import { Logger } from '@nestjs/common';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import {
  type ClaimCheckJobData,
  type RouteOpportunityJobData,
} from 'src/modules/enso/lead-pipeline/jobs/lead-pipeline-job.types';
import { RouteOpportunityJob } from 'src/modules/enso/lead-pipeline/jobs/route-opportunity.job';
import { MAX_ROUTING_ATTEMPTS } from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';
import { ManagerNotificationService } from 'src/modules/enso/lead-pipeline/services/manager-notification.service';
import { OpportunityRoutingService } from 'src/modules/enso/lead-pipeline/services/opportunity-routing.service';

// The claim window expired. Idempotent: if the deal left ROUTING (manager
// claimed) this is a no-op. Otherwise reroute to the next manager — or, once
// MAX_ROUTING_ATTEMPTS is reached, stall the deal and escalate to ops.
@Processor(MessageQueue.ensoLeadPipelineQueue)
export class ClaimCheckJob {
  private readonly logger = new Logger(ClaimCheckJob.name);

  constructor(
    private readonly opportunityRoutingService: OpportunityRoutingService,
    private readonly managerNotificationService: ManagerNotificationService,
    @InjectMessageQueue(MessageQueue.ensoLeadPipelineQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {}

  @Process(ClaimCheckJob.name)
  async handle(data: ClaimCheckJobData): Promise<void> {
    const { workspaceId, opportunityId, attempt, excludedManagerIds } = data;

    const authContext = buildSystemAuthContext(workspaceId);

    const stage = await this.opportunityRoutingService.getOpportunityStage(
      authContext,
      opportunityId,
    );

    // Claimed (or gone) — nothing to do.
    if (stage === null || stage !== 'ROUTING') {
      return;
    }

    const nextAttempt = attempt + 1;

    if (nextAttempt >= MAX_ROUTING_ATTEMPTS) {
      await this.opportunityRoutingService.markStalled(
        authContext,
        opportunityId,
      );
      await this.managerNotificationService.notifyEscalation(authContext, {
        opportunityId,
        reason: `Could not be claimed after ${nextAttempt} routing attempts.`,
        attempts: nextAttempt,
      });

      return;
    }

    await this.messageQueueService.add<RouteOpportunityJobData>(
      RouteOpportunityJob.name,
      {
        workspaceId,
        opportunityId,
        excludedManagerIds,
        attempt: nextAttempt,
      },
    );
  }
}
