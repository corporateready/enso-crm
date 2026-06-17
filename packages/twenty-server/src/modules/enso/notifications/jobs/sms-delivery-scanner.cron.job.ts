import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { Repository } from 'typeorm';

import { SentryCronMonitor } from 'src/engine/core-modules/cron/sentry-cron-monitor.decorator';
import { ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { MarketingSmsService } from 'src/modules/enso/marketing-sync/services/marketing-sms.service';
import { SMS_DELIVERY_SCANNER_CRON_PATTERN } from 'src/modules/enso/notifications/notifications.constants';

// Runs every 2 minutes. sms.md has no push delivery-receipt webhook, so for each
// active workspace we poll the status of recent, not-yet-final SMS sends and
// refresh deliveryStatus on the outboundActivity. Silent — no timeline event.
@Processor(MessageQueue.cronQueue)
export class SmsDeliveryScannerCronJob {
  private readonly logger = new Logger(SmsDeliveryScannerCronJob.name);

  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly marketingSmsService: MarketingSmsService,
    private readonly exceptionHandlerService: ExceptionHandlerService,
  ) {}

  @Process(SmsDeliveryScannerCronJob.name)
  @SentryCronMonitor(
    SmsDeliveryScannerCronJob.name,
    SMS_DELIVERY_SCANNER_CRON_PATTERN,
  )
  async handle(): Promise<void> {
    const workspaces = await this.workspaceRepository.find({
      where: { activationStatus: WorkspaceActivationStatus.ACTIVE },
    });

    for (const workspace of workspaces) {
      try {
        await this.marketingSmsService.pollDeliveryStatuses(workspace.id);
      } catch (error) {
        this.logger.error(
          `SMS delivery poll failed for workspace ${workspace.id}: ${(error as Error).message}`,
        );
        this.exceptionHandlerService.captureExceptions([error as Error]);
      }
    }
  }
}
