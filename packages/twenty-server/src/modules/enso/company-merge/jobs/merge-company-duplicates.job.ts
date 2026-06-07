import { Logger } from '@nestjs/common';

import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type MergeCompanyDuplicatesJobData } from 'src/modules/enso/company-merge/jobs/company-merge-job.types';
import { CompanyMergeExecutorService } from 'src/modules/enso/company-merge/services/company-merge-executor.service';

// Executor: merge a confirmed duplicate set into the oldest record.
@Processor(MessageQueue.ensoCompanyMergeQueue)
export class MergeCompanyDuplicatesJob {
  private readonly logger = new Logger(MergeCompanyDuplicatesJob.name);

  constructor(
    private readonly companyMergeExecutorService: CompanyMergeExecutorService,
  ) {}

  @Process(MergeCompanyDuplicatesJob.name)
  async handle(data: MergeCompanyDuplicatesJobData): Promise<void> {
    const { workspaceId, companyIds } = data;

    const authContext = buildSystemAuthContext(workspaceId);

    await this.companyMergeExecutorService.mergeDuplicates(
      authContext,
      companyIds,
    );
  }
}
