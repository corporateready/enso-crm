import { Logger } from '@nestjs/common';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import {
  type FindCompanyDuplicatesJobData,
  type MergeCompanyDuplicatesJobData,
} from 'src/modules/enso/company-merge/jobs/company-merge-job.types';
import { MergeCompanyDuplicatesJob } from 'src/modules/enso/company-merge/jobs/merge-company-duplicates.job';
import { CompanyDuplicateFinderService } from 'src/modules/enso/company-merge/services/company-duplicate-finder.service';

// Trigger: a company was created/updated/enriched. If it now shares a
// registration number / domain with other companies, hand the duplicate set off
// to the merge job.
@Processor(MessageQueue.ensoCompanyMergeQueue)
export class FindCompanyDuplicatesJob {
  private readonly logger = new Logger(FindCompanyDuplicatesJob.name);

  constructor(
    private readonly companyDuplicateFinderService: CompanyDuplicateFinderService,
    @InjectMessageQueue(MessageQueue.ensoCompanyMergeQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {}

  @Process(FindCompanyDuplicatesJob.name)
  async handle(data: FindCompanyDuplicatesJobData): Promise<void> {
    const { workspaceId, companyId } = data;

    const authContext = buildSystemAuthContext(workspaceId);

    const duplicateSet =
      await this.companyDuplicateFinderService.findDuplicateSet(
        authContext,
        companyId,
      );

    if (!duplicateSet || duplicateSet.length < 2) {
      return;
    }

    await this.messageQueueService.add<MergeCompanyDuplicatesJobData>(
      MergeCompanyDuplicatesJob.name,
      { workspaceId, companyIds: duplicateSet },
    );
  }
}
