import { Command, CommandRunner } from 'nest-commander';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { SmsDeliveryScannerCronJob } from 'src/modules/enso/notifications/jobs/sms-delivery-scanner.cron.job';
import { SMS_DELIVERY_SCANNER_CRON_PATTERN } from 'src/modules/enso/notifications/notifications.constants';

@Command({
  name: 'cron:enso:sms-delivery-scanner',
  description:
    'Starts the cron that polls sms.md for SMS delivery status (no push DLR).',
})
export class SmsDeliveryScannerCronCommand extends CommandRunner {
  constructor(
    @InjectMessageQueue(MessageQueue.cronQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {
    super();
  }

  async run(): Promise<void> {
    await this.messageQueueService.addCron<undefined>({
      jobName: SmsDeliveryScannerCronJob.name,
      data: undefined,
      options: {
        repeat: {
          pattern: SMS_DELIVERY_SCANNER_CRON_PATTERN,
        },
      },
    });
  }
}
