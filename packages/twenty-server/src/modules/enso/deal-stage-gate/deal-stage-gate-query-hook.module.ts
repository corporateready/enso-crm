import { Module } from '@nestjs/common';

import { OpportunityUpdateManyStageGatePreQueryHook } from 'src/modules/enso/deal-stage-gate/query-hooks/opportunity-update-many.pre-query-hook';
import { OpportunityUpdateOneStageGatePreQueryHook } from 'src/modules/enso/deal-stage-gate/query-hooks/opportunity-update-one.pre-query-hook';
import { DealStageGateService } from 'src/modules/enso/deal-stage-gate/services/deal-stage-gate.service';

@Module({
  providers: [
    DealStageGateService,
    OpportunityUpdateOneStageGatePreQueryHook,
    OpportunityUpdateManyStageGatePreQueryHook,
  ],
  exports: [DealStageGateService],
})
export class DealStageGateQueryHookModule {}
