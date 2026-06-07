import { Module } from '@nestjs/common';

import { FindCompanyDuplicatesJob } from 'src/modules/enso/company-merge/jobs/find-company-duplicates.job';
import { MergeCompanyDuplicatesJob } from 'src/modules/enso/company-merge/jobs/merge-company-duplicates.job';
import { CompanyDuplicateFinderService } from 'src/modules/enso/company-merge/services/company-duplicate-finder.service';
import { CompanyMergeExecutorService } from 'src/modules/enso/company-merge/services/company-merge-executor.service';

// WORKER side of company identity resolution: the find + merge BullMQ jobs and
// their services. Imported by JobsModule (loaded by the queue worker) so the
// message-queue explorer discovers the @Processor classes. The server-side POST
// hooks live in CompanyMergeModule. (Mirrors PersonMergeJobsModule.)
@Module({
  providers: [
    CompanyDuplicateFinderService,
    CompanyMergeExecutorService,
    FindCompanyDuplicatesJob,
    MergeCompanyDuplicatesJob,
  ],
})
export class CompanyMergeJobsModule {}
