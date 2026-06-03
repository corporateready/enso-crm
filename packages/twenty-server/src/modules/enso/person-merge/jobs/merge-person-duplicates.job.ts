import { Logger } from '@nestjs/common';

import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type MergePersonDuplicatesJobData } from 'src/modules/enso/person-merge/jobs/person-merge-job.types';
import { PersonMergeExecutorService } from 'src/modules/enso/person-merge/services/person-merge-executor.service';

// Stage-2 executor: merge a confirmed duplicate set into the oldest record.
@Processor(MessageQueue.ensoPersonMergeQueue)
export class MergePersonDuplicatesJob {
  private readonly logger = new Logger(MergePersonDuplicatesJob.name);

  constructor(
    private readonly personMergeExecutorService: PersonMergeExecutorService,
  ) {}

  @Process(MergePersonDuplicatesJob.name)
  async handle(data: MergePersonDuplicatesJobData): Promise<void> {
    const { workspaceId, personIds } = data;

    const authContext = buildSystemAuthContext(workspaceId);

    await this.personMergeExecutorService.mergeDuplicates(
      authContext,
      personIds,
    );
  }
}
