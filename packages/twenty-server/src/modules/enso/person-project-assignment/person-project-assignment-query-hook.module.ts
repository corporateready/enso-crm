import { Module } from '@nestjs/common';

import { PersonProjectAssignmentCreateManyPreQueryHook } from 'src/modules/enso/person-project-assignment/query-hooks/person-project-assignment-create-many.pre-query-hook';
import { PersonProjectAssignmentCreateOnePreQueryHook } from 'src/modules/enso/person-project-assignment/query-hooks/person-project-assignment-create-one.pre-query-hook';
import { PersonProjectAssignmentUpdateOnePreQueryHook } from 'src/modules/enso/person-project-assignment/query-hooks/person-project-assignment-update-one.pre-query-hook';
import { PersonProjectAssignmentNameService } from 'src/modules/enso/person-project-assignment/services/person-project-assignment-name.service';

@Module({
  providers: [
    PersonProjectAssignmentNameService,
    PersonProjectAssignmentCreateOnePreQueryHook,
    PersonProjectAssignmentCreateManyPreQueryHook,
    PersonProjectAssignmentUpdateOnePreQueryHook,
  ],
})
export class PersonProjectAssignmentQueryHookModule {}
