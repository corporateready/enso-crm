import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { type UpdateOneResolverArgs } from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';

import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { DealStageGateService } from 'src/modules/enso/deal-stage-gate/services/deal-stage-gate.service';

@Injectable()
@WorkspaceQueryHook(`opportunity.updateOne`)
export class OpportunityUpdateOneStageGatePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly dealStageGateService: DealStageGateService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: UpdateOneResolverArgs<Record<string, unknown>>,
  ): Promise<UpdateOneResolverArgs<Record<string, unknown>>> {
    if (!isDefined(payload.data)) {
      return payload;
    }

    await this.dealStageGateService.assertCanUpdate(
      authContext,
      [payload.id],
      payload.data,
    );

    return payload;
  }
}
