import { Logger } from '@nestjs/common';

import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { type MarketingSyncJobData } from 'src/modules/enso/marketing-sync/marketing-sync.constants';
import { DittofeedClientService } from 'src/modules/enso/marketing-sync/services/dittofeed-client.service';

// Worker-side executor: takes a prepared identify/track payload (built by the
// listener) and pushes it to Dittofeed. Kept thin so BullMQ retries handle a
// transient Dittofeed/Resend outage; the client throws on HTTP failure.
@Processor(MessageQueue.ensoMarketingSyncQueue)
export class MarketingSyncJob {
  private readonly logger = new Logger(MarketingSyncJob.name);

  constructor(
    private readonly dittofeedClientService: DittofeedClientService,
  ) {}

  @Process(MarketingSyncJob.name)
  async handle(data: MarketingSyncJobData): Promise<void> {
    if (data.kind === 'identify') {
      await this.dittofeedClientService.identify(data.workspaceId, {
        userId: data.userId,
        traits: data.traits,
        messageId: data.messageId,
      });

      return;
    }

    await this.dittofeedClientService.track(data.workspaceId, {
      userId: data.userId,
      event: data.event,
      properties: data.properties,
      timestamp: data.timestamp,
      messageId: data.messageId,
    });
  }
}
