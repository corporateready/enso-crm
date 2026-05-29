import { Module } from '@nestjs/common';

import { PersonRelationshipCreateManyPostQueryHook } from 'src/modules/enso/person-relationship/query-hooks/person-relationship-create-many.post-query-hook';
import { PersonRelationshipCreateManyPreQueryHook } from 'src/modules/enso/person-relationship/query-hooks/person-relationship-create-many.pre-query-hook';
import { PersonRelationshipCreateOnePostQueryHook } from 'src/modules/enso/person-relationship/query-hooks/person-relationship-create-one.post-query-hook';
import { PersonRelationshipCreateOnePreQueryHook } from 'src/modules/enso/person-relationship/query-hooks/person-relationship-create-one.pre-query-hook';
import { PersonRelationshipDeleteOnePostQueryHook } from 'src/modules/enso/person-relationship/query-hooks/person-relationship-delete-one.post-query-hook';
import { PersonRelationshipUpdateOnePostQueryHook } from 'src/modules/enso/person-relationship/query-hooks/person-relationship-update-one.post-query-hook';
import { PersonRelationshipUpdateOnePreQueryHook } from 'src/modules/enso/person-relationship/query-hooks/person-relationship-update-one.pre-query-hook';
import { PersonRelationshipMirrorService } from 'src/modules/enso/person-relationship/services/person-relationship-mirror.service';
import { PersonRelationshipNameService } from 'src/modules/enso/person-relationship/services/person-relationship-name.service';

@Module({
  providers: [
    PersonRelationshipNameService,
    PersonRelationshipMirrorService,
    PersonRelationshipCreateOnePreQueryHook,
    PersonRelationshipCreateManyPreQueryHook,
    PersonRelationshipUpdateOnePreQueryHook,
    PersonRelationshipCreateOnePostQueryHook,
    PersonRelationshipCreateManyPostQueryHook,
    PersonRelationshipUpdateOnePostQueryHook,
    PersonRelationshipDeleteOnePostQueryHook,
  ],
})
export class PersonRelationshipQueryHookModule {}
