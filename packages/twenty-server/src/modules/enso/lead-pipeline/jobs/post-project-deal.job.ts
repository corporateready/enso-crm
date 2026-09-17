import { Logger } from '@nestjs/common';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type PostProjectDealJobData } from 'src/modules/enso/lead-pipeline/jobs/lead-pipeline-job.types';
import {
  PROJECT_DEAL_POST_MAX_ATTEMPTS,
  PROJECT_DEAL_POST_POLL_MS,
} from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';
import { ProjectNotificationService } from 'src/modules/enso/lead-pipeline/services/project-notification.service';

// Posts a new deal to its project's marketing room, once the deal is worth
// describing.
//
// A job rather than a call inside the resolution service because of calls: a
// call's deal opens the moment an individual accepts, while the conversation is
// still going, and at that point nothing about the call is final — no duration,
// and a status that can belong to a leg that lost the race to answer. The post
// waits for the provider's closing push instead, which means waiting for the
// call to end, which is exactly what a delayed, re-enqueuing job is for.
//
// Every other channel — a form, a DM, a lead ad — is complete on arrival and
// posts on the first pass.
@Processor(MessageQueue.ensoLeadPipelineQueue)
export class PostProjectDealJob {
  private readonly logger = new Logger(PostProjectDealJob.name);

  constructor(
    private readonly projectNotificationService: ProjectNotificationService,
    @InjectMessageQueue(MessageQueue.ensoLeadPipelineQueue)
    private readonly leadPipelineQueueService: MessageQueueService,
  ) {}

  @Process(PostProjectDealJob.name)
  async handle(data: PostProjectDealJobData): Promise<void> {
    const { workspaceId, opportunityId, attempt = 1 } = data;

    const isLastAttempt = attempt >= PROJECT_DEAL_POST_MAX_ATTEMPTS;

    const outcome = await this.projectNotificationService.notifyNewDeal(
      buildSystemAuthContext(workspaceId),
      { opportunityId, postWithoutFinalCallOutcome: isLastAttempt },
    );

    if (outcome !== 'awaiting-call-outcome') {
      return;
    }

    // Unreachable while `isLastAttempt` forces a post, but stated rather than
    // assumed: this is the loop's only exit.
    if (isLastAttempt) {
      this.logger.warn(
        `Deal ${opportunityId} still had no final call outcome after ${attempt} attempts`,
      );

      return;
    }

    // Re-enqueue rather than throw, for the same reason the recording archive
    // does: a BullMQ retry uses the queue's backoff, which is tuned for
    // transient database errors and far too fast for "the call is still going".
    // The attempt is part of the job id because a completed id is not reusable.
    await this.leadPipelineQueueService.add<PostProjectDealJobData>(
      PostProjectDealJob.name,
      { ...data, attempt: attempt + 1 },
      {
        id: `enso-project-deal-post:${opportunityId}:${attempt + 1}`,
        delay: PROJECT_DEAL_POST_POLL_MS,
      },
    );
  }
}
