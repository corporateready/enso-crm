import { Module } from '@nestjs/common';

import { CompanyMergeCompanyCreateManyPostQueryHook } from 'src/modules/enso/company-merge/query-hooks/company-create-many.post-query-hook';
import { CompanyMergeCompanyCreateOnePostQueryHook } from 'src/modules/enso/company-merge/query-hooks/company-create-one.post-query-hook';
import { CompanyMergeCompanyUpdateManyPostQueryHook } from 'src/modules/enso/company-merge/query-hooks/company-update-many.post-query-hook';
import { CompanyMergeCompanyUpdateOnePostQueryHook } from 'src/modules/enso/company-merge/query-hooks/company-update-one.post-query-hook';

// SERVER side of company identity resolution: POST hooks on company create/update
// that enqueue a duplicate check. Catches companies written through the GraphQL
// API. Imported by WorkspaceQueryHookModule so the query-hook explorer discovers
// them. The worker-side find + merge jobs live in CompanyMergeJobsModule (loaded
// by JobsModule). (Mirrors PersonMergeModule.)
@Module({
  providers: [
    CompanyMergeCompanyCreateOnePostQueryHook,
    CompanyMergeCompanyCreateManyPostQueryHook,
    CompanyMergeCompanyUpdateOnePostQueryHook,
    CompanyMergeCompanyUpdateManyPostQueryHook,
  ],
})
export class CompanyMergeModule {}
