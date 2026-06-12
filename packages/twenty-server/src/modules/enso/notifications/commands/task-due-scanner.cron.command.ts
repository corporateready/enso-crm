import { Command, CommandRunner } from 'nest-commander';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { TaskDueScannerCronJob } from 'src/modules/enso/notifications/jobs/task-due-scanner.cron.job';
import { TASK_DUE_SCANNER_CRON_PATTERN } from 'src/modules/enso/notifications/notifications.constants';

@Command({
  name: 'cron:enso:task-due-scanner',
  description:
    'Starts the cron that notifies managers when their tasks reach the due time.',
})
export class TaskDueScannerCronCommand extends CommandRunner {
  constructor(
    @InjectMessageQueue(MessageQueue.cronQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {
    super();
  }

  async run(): Promise<void> {
    await this.messageQueueService.addCron<undefined>({
      jobName: TaskDueScannerCronJob.name,
      data: undefined,
      options: {
        repeat: {
          pattern: TASK_DUE_SCANNER_CRON_PATTERN,
        },
      },
    });
  }
}
