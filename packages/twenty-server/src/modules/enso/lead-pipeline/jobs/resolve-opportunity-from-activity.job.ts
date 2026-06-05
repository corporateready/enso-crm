import { Logger } from '@nestjs/common';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import {
  type ResolveOpportunityFromActivityJobData,
  type RouteOpportunityJobData,
} from 'src/modules/enso/lead-pipeline/jobs/lead-pipeline-job.types';
import { RouteOpportunityJob } from 'src/modules/enso/lead-pipeline/jobs/route-opportunity.job';
import { OpportunityResolutionService } from 'src/modules/enso/lead-pipeline/services/opportunity-resolution.service';

// Stage 1 of the pipeline: an inbound activity was created. Resolve it to an
// opportunity (dedup → attach or create). If a NEW deal was created it needs
// routing, so hand off to the routing job. Attaching to an existing open deal
// is terminal here.
@Processor(MessageQueue.ensoLeadPipelineQueue)
export class ResolveOpportunityFromActivityJob {
  private readonly logger = new Logger(ResolveOpportunityFromActivityJob.name);

  constructor(
    private readonly opportunityResolutionService: OpportunityResolutionService,
    @InjectMessageQueue(MessageQueue.ensoLeadPipelineQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {}

  @Process(ResolveOpportunityFromActivityJob.name)
  async handle(data: ResolveOpportunityFromActivityJobData): Promise<void> {
    const { workspaceId, activityId } = data;

    const authContext = buildSystemAuthContext(workspaceId);

    const result = await this.opportunityResolutionService.resolveFromActivity(
      authContext,
      activityId,
    );

    if (!result || !result.created) {
      return;
    }

    await this.messageQueueService.add<RouteOpportunityJobData>(
      RouteOpportunityJob.name,
      {
        workspaceId,
        opportunityId: result.opportunityId,
        excludedManagerIds: [],
        attempt: 0,
      },
    );
  }
}
