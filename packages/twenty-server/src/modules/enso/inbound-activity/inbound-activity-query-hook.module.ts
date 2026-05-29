import { Module } from '@nestjs/common';

import { InboundActivityCreateManyPreQueryHook } from 'src/modules/enso/inbound-activity/query-hooks/inbound-activity-create-many.pre-query-hook';
import { InboundActivityCreateOnePreQueryHook } from 'src/modules/enso/inbound-activity/query-hooks/inbound-activity-create-one.pre-query-hook';
import { InboundActivityUpdateOnePreQueryHook } from 'src/modules/enso/inbound-activity/query-hooks/inbound-activity-update-one.pre-query-hook';
import { InboundActivityNameService } from 'src/modules/enso/inbound-activity/services/inbound-activity-name.service';

@Module({
  providers: [
    InboundActivityNameService,
    InboundActivityCreateOnePreQueryHook,
    InboundActivityCreateManyPreQueryHook,
    InboundActivityUpdateOnePreQueryHook,
  ],
})
export class InboundActivityQueryHookModule {}
