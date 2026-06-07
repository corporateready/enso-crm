import { Logger } from '@nestjs/common';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { EnrichCompanyJob } from 'src/modules/enso/company-enrichment/jobs/enrich-company.job';
import {
  type EnrichCompanyJobData,
  type ResolveCompanyFromPersonJobData,
} from 'src/modules/enso/company-enrichment/jobs/company-enrichment-job.types';
import { CompanyFromPersonService } from 'src/modules/enso/company-enrichment/services/company-from-person.service';

// Stage 1: a person was created/updated. Create-or-restore the company for their
// work-email domain and link them. If a company was (re)created, hand off to the
// enrichment job — attaching to an already-enriched company is terminal here.
@Processor(MessageQueue.ensoCompanyEnrichmentQueue)
export class ResolveCompanyFromPersonJob {
  private readonly logger = new Logger(ResolveCompanyFromPersonJob.name);

  constructor(
    private readonly companyFromPersonService: CompanyFromPersonService,
    @InjectMessageQueue(MessageQueue.ensoCompanyEnrichmentQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {}

  @Process(ResolveCompanyFromPersonJob.name)
  async handle(data: ResolveCompanyFromPersonJobData): Promise<void> {
    const { workspaceId, personId } = data;

    const outcome = await this.companyFromPersonService.resolveFromPerson(
      workspaceId,
      personId,
    );

    if (!outcome || !outcome.created) {
      return;
    }

    await this.messageQueueService.add<EnrichCompanyJobData>(
      EnrichCompanyJob.name,
      { workspaceId, companyId: outcome.companyId },
    );
  }
}
