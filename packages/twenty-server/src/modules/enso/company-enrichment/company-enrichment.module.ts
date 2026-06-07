import { Module } from '@nestjs/common';

import { CompanyEnrichmentPersonCreateManyPostQueryHook } from 'src/modules/enso/company-enrichment/query-hooks/person-create-many.post-query-hook';
import { CompanyEnrichmentPersonCreateOnePostQueryHook } from 'src/modules/enso/company-enrichment/query-hooks/person-create-one.post-query-hook';
import { CompanyEnrichmentPersonUpdateManyPostQueryHook } from 'src/modules/enso/company-enrichment/query-hooks/person-update-many.post-query-hook';
import { CompanyEnrichmentPersonUpdateOnePostQueryHook } from 'src/modules/enso/company-enrichment/query-hooks/person-update-one.post-query-hook';

// SERVER side of company auto-creation: POST hooks on person create/update that
// enqueue a company-resolution job. Imported by WorkspaceQueryHookModule so the
// query-hook explorer discovers them. The worker-side jobs + services live in
// CompanyEnrichmentJobsModule (loaded by JobsModule) — the worker boots
// QueueWorkerModule, which does NOT import the query-hook graph, so jobs are
// registered there separately. (Mirrors PersonMergeModule.)
@Module({
  providers: [
    CompanyEnrichmentPersonCreateOnePostQueryHook,
    CompanyEnrichmentPersonCreateManyPostQueryHook,
    CompanyEnrichmentPersonUpdateOnePostQueryHook,
    CompanyEnrichmentPersonUpdateManyPostQueryHook,
  ],
})
export class CompanyEnrichmentModule {}
