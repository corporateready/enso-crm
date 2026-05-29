import { Module } from '@nestjs/common';

import { PersonProjectConsentCreateManyPreQueryHook } from 'src/modules/enso/person-project-consent/query-hooks/person-project-consent-create-many.pre-query-hook';
import { PersonProjectConsentCreateOnePreQueryHook } from 'src/modules/enso/person-project-consent/query-hooks/person-project-consent-create-one.pre-query-hook';
import { PersonProjectConsentUpdateOnePreQueryHook } from 'src/modules/enso/person-project-consent/query-hooks/person-project-consent-update-one.pre-query-hook';
import { PersonProjectConsentNameService } from 'src/modules/enso/person-project-consent/services/person-project-consent-name.service';

@Module({
  providers: [
    PersonProjectConsentNameService,
    PersonProjectConsentCreateOnePreQueryHook,
    PersonProjectConsentCreateManyPreQueryHook,
    PersonProjectConsentUpdateOnePreQueryHook,
  ],
})
export class PersonProjectConsentQueryHookModule {}
