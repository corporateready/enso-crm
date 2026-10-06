import { Module } from '@nestjs/common';

import {
  OpportunityCreateGuardService,
  OpportunityCreateManyGuardPreQueryHook,
  OpportunityCreateOneGuardPreQueryHook,
} from 'src/modules/enso/manual-lead/query-hooks/opportunity-create-guard.pre-query-hook';
import { EnsoViewerScopeModule } from 'src/modules/enso/record-visibility/enso-viewer-scope.module';

@Module({
  imports: [EnsoViewerScopeModule],
  providers: [
    OpportunityCreateGuardService,
    OpportunityCreateOneGuardPreQueryHook,
    OpportunityCreateManyGuardPreQueryHook,
  ],
})
export class ManualLeadQueryHookModule {}
