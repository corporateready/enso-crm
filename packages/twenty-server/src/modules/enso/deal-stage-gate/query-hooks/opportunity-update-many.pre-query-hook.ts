import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { type UpdateManyResolverArgs } from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';

import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { DealStageGateService } from 'src/modules/enso/deal-stage-gate/services/deal-stage-gate.service';

@Injectable()
@WorkspaceQueryHook(`opportunity.updateMany`)
export class OpportunityUpdateManyStageGatePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly dealStageGateService: DealStageGateService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: UpdateManyResolverArgs<Record<string, unknown>>,
  ): Promise<UpdateManyResolverArgs<Record<string, unknown>>> {
    if (
      !isDefined(payload.data) ||
      !this.dealStageGateService.touchesGate(payload.data)
    ) {
      return payload;
    }

    const ids = this.dealStageGateService.extractIdsFromFilter(payload.filter);

    if (!isDefined(ids)) {
      throw this.dealStageGateService.buildUnscopedBulkUpdateException();
    }

    await this.dealStageGateService.assertCanUpdate(
      authContext,
      ids,
      payload.data,
    );

    return payload;
  }
}
