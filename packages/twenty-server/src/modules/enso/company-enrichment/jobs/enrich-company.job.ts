import { Logger } from '@nestjs/common';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { type EnrichCompanyJobData } from 'src/modules/enso/company-enrichment/jobs/company-enrichment-job.types';
import { CompanyEnrichmentService } from 'src/modules/enso/company-enrichment/services/company-enrichment.service';
import { FindCompanyDuplicatesJob } from 'src/modules/enso/company-merge/jobs/find-company-duplicates.job';
import { type FindCompanyDuplicatesJobData } from 'src/modules/enso/company-merge/jobs/company-merge-job.types';

// Stage 2: run the enrichment provider chain for a single company and write the
// merged firmographics onto it. Best-effort — the service swallows failures and
// records enrichmentStatus rather than throwing.
//
// When enrichment resolves a registration number, hand off to company-merge: the
// enrichment write above goes through the ORM (not the GraphQL resolver), so the
// company.* dedup hooks don't fire for it. This is what catches "acme.ro" and
// "acme.com" once they're enriched to the same VAT.
@Processor(MessageQueue.ensoCompanyEnrichmentQueue)
export class EnrichCompanyJob {
  private readonly logger = new Logger(EnrichCompanyJob.name);

  constructor(
    private readonly companyEnrichmentService: CompanyEnrichmentService,
    @InjectMessageQueue(MessageQueue.ensoCompanyMergeQueue)
    private readonly companyMergeQueueService: MessageQueueService,
  ) {}

  @Process(EnrichCompanyJob.name)
  async handle(data: EnrichCompanyJobData): Promise<void> {
    const { workspaceId, companyId } = data;

    const hasRegistrationNumber =
      await this.companyEnrichmentService.enrichCompany(workspaceId, companyId);

    if (!hasRegistrationNumber) {
      return;
    }

    await this.companyMergeQueueService.add<FindCompanyDuplicatesJobData>(
      FindCompanyDuplicatesJob.name,
      { workspaceId, companyId },
    );
  }
}
