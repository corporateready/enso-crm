import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { type CreateManyResolverArgs } from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';

import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { CampaignProjectService } from 'src/modules/enso/inbound-activity/services/campaign-project.service';
import { InboundActivityNameService } from 'src/modules/enso/inbound-activity/services/inbound-activity-name.service';
import { withCanonicalUtmMedium } from 'src/modules/enso/inbound-activity/utils/canonicalize-utm-medium.util';

@Injectable()
@WorkspaceQueryHook(`inboundActivity.createMany`)
export class InboundActivityCreateManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly inboundActivityNameService: InboundActivityNameService,
    private readonly campaignProjectService: CampaignProjectService,
  ) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: CreateManyResolverArgs<Record<string, unknown>>,
  ): Promise<CreateManyResolverArgs<Record<string, unknown>>> {
    if (!isDefined(payload.data)) {
      return payload;
    }

    // One project read for the whole batch, then the per-record label.
    const routed = await this.campaignProjectService.withCampaignProjects(
      authContext,
      payload.data.map((record) => withCanonicalUtmMedium(record)),
    );

    const data = await Promise.all(
      routed.map(async (record) => {
        const name = await this.inboundActivityNameService.computeName(
          authContext,
          record,
        );

        return isDefined(name) ? { ...record, name } : record;
      }),
    );

    return { ...payload, data };
  }
}
