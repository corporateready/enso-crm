import { Module } from '@nestjs/common';

import { PersonRelationshipCreateManyPreQueryHook } from 'src/modules/enso/person-relationship/query-hooks/person-relationship-create-many.pre-query-hook';
import { PersonRelationshipCreateOnePreQueryHook } from 'src/modules/enso/person-relationship/query-hooks/person-relationship-create-one.pre-query-hook';
import { PersonRelationshipUpdateOnePreQueryHook } from 'src/modules/enso/person-relationship/query-hooks/person-relationship-update-one.pre-query-hook';
import { PersonRelationshipNameService } from 'src/modules/enso/person-relationship/services/person-relationship-name.service';

@Module({
  providers: [
    PersonRelationshipNameService,
    PersonRelationshipCreateOnePreQueryHook,
    PersonRelationshipCreateManyPreQueryHook,
    PersonRelationshipUpdateOnePreQueryHook,
  ],
})
export class PersonRelationshipQueryHookModule {}
