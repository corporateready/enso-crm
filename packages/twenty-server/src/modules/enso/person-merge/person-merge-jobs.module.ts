import { Module } from '@nestjs/common';

import { FindPersonDuplicatesJob } from 'src/modules/enso/person-merge/jobs/find-person-duplicates.job';
import { MergePersonDuplicatesJob } from 'src/modules/enso/person-merge/jobs/merge-person-duplicates.job';
import { PersonDuplicateFinderService } from 'src/modules/enso/person-merge/services/person-duplicate-finder.service';
import { PersonMergeExecutorService } from 'src/modules/enso/person-merge/services/person-merge-executor.service';

// WORKER side of stage-2 identity resolution: the find + merge BullMQ jobs and
// their services. Imported by JobsModule (loaded by the queue worker) so the
// message-queue explorer discovers the @Processor classes.
@Module({
  providers: [
    PersonDuplicateFinderService,
    PersonMergeExecutorService,
    FindPersonDuplicatesJob,
    MergePersonDuplicatesJob,
  ],
})
export class PersonMergeJobsModule {}
