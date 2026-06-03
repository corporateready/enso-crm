import { Module } from '@nestjs/common';

import { PersonCreateOnePostQueryHook } from 'src/modules/enso/person-merge/query-hooks/person-create-one.post-query-hook';
import { PersonUpdateOnePostQueryHook } from 'src/modules/enso/person-merge/query-hooks/person-update-one.post-query-hook';

// SERVER side of stage-2 identity resolution: POST hooks on person create/update
// that enqueue a duplicate check. Imported by WorkspaceQueryHookModule. The
// worker-side jobs + services live in PersonMergeJobsModule (loaded by JobsModule).
@Module({
  providers: [PersonCreateOnePostQueryHook, PersonUpdateOnePostQueryHook],
})
export class PersonMergeModule {}
