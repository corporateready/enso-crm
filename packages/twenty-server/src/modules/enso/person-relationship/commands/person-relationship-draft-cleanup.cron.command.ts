import { Command, CommandRunner } from 'nest-commander';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { PersonRelationshipDraftCleanupCronJob } from 'src/modules/enso/person-relationship/jobs/person-relationship-draft-cleanup.cron.job';
import { PERSON_RELATIONSHIP_DRAFT_CLEANUP_CRON_PATTERN } from 'src/modules/enso/person-relationship/person-relationship.constants';

@Command({
  name: 'cron:enso:person-relationship-draft-cleanup',
  description:
    'Starts the cron that moves abandoned, half-filled family links to trash.',
})
export class PersonRelationshipDraftCleanupCronCommand extends CommandRunner {
  constructor(
    @InjectMessageQueue(MessageQueue.cronQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {
    super();
  }

  async run(): Promise<void> {
    await this.messageQueueService.addCron<undefined>({
      jobName: PersonRelationshipDraftCleanupCronJob.name,
      data: undefined,
      options: {
        repeat: {
          pattern: PERSON_RELATIONSHIP_DRAFT_CLEANUP_CRON_PATTERN,
        },
      },
    });
  }
}
