import { Logger } from '@nestjs/common';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import {
  type FindPersonDuplicatesJobData,
  type MergePersonDuplicatesJobData,
} from 'src/modules/enso/person-merge/jobs/person-merge-job.types';
import { MergePersonDuplicatesJob } from 'src/modules/enso/person-merge/jobs/merge-person-duplicates.job';
import { PersonDuplicateFinderService } from 'src/modules/enso/person-merge/services/person-duplicate-finder.service';

// Stage-2 trigger: a person was created/updated. If it now shares a phone/email
// with other people, hand the duplicate set off to the merge job.
@Processor(MessageQueue.ensoPersonMergeQueue)
export class FindPersonDuplicatesJob {
  private readonly logger = new Logger(FindPersonDuplicatesJob.name);

  constructor(
    private readonly personDuplicateFinderService: PersonDuplicateFinderService,
    @InjectMessageQueue(MessageQueue.ensoPersonMergeQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {}

  @Process(FindPersonDuplicatesJob.name)
  async handle(data: FindPersonDuplicatesJobData): Promise<void> {
    const { workspaceId, personId } = data;

    const authContext = buildSystemAuthContext(workspaceId);

    const duplicateSet =
      await this.personDuplicateFinderService.findDuplicateSet(
        authContext,
        personId,
      );

    if (!duplicateSet || duplicateSet.length < 2) {
      return;
    }

    await this.messageQueueService.add<MergePersonDuplicatesJobData>(
      MergePersonDuplicatesJob.name,
      { workspaceId, personIds: duplicateSet },
    );
  }
}
