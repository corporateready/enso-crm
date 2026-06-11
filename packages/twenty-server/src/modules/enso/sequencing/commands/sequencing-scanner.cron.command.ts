import { Command, CommandRunner } from 'nest-commander';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { SequencingScannerCronJob } from 'src/modules/enso/sequencing/jobs/sequencing-scanner.cron.job';
import { SEQUENCING_SCANNER_CRON_PATTERN } from 'src/modules/enso/sequencing/sequencing.constants';

@Command({
  name: 'cron:enso:sequencing-scanner',
  description:
    'Starts the cron that sweeps open sequence runs: due follow-ups, stall, auto-close.',
})
export class SequencingScannerCronCommand extends CommandRunner {
  constructor(
    @InjectMessageQueue(MessageQueue.cronQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {
    super();
  }

  async run(): Promise<void> {
    await this.messageQueueService.addCron<undefined>({
      jobName: SequencingScannerCronJob.name,
      data: undefined,
      options: {
        repeat: {
          pattern: SEQUENCING_SCANNER_CRON_PATTERN,
        },
      },
    });
  }
}
