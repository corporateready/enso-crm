import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { type CreateOneResolverArgs } from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';

import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { CampaignProjectService } from 'src/modules/enso/inbound-activity/services/campaign-project.service';
import { InboundActivityNameService } from 'src/modules/enso/inbound-activity/services/inbound-activity-name.service';
import { withCanonicalUtmMedium } from 'src/modules/enso/inbound-activity/utils/canonicalize-utm-medium.util';

@Injectable()
@WorkspaceQueryHook(`inboundActivity.createOne`)
export class InboundActivityCreateOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly inboundActivityNameService: InboundActivityNameService,
    private readonly campaignProjectService: CampaignProjectService,
  ) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: CreateOneResolverArgs<Record<string, unknown>>,
  ): Promise<CreateOneResolverArgs<Record<string, unknown>>> {
    if (!isDefined(payload.data)) {
      return payload;
    }

    // Canonicalise here rather than in each intake workflow: social DMs, lead ads
    // and forms all land through this hook, so one alias table covers them and
    // n8n stays free to write exactly what the source said. Calls do NOT come
    // through here — the worker inserts them directly — but their call-tracking
    // mediums need no alias.
    const canonical = withCanonicalUtmMedium(payload.data);

    // Project before name: the label embeds the project, and a lead from a
    // multi-project page should be named for the project its campaign promotes.
    const [data] = await this.campaignProjectService.withCampaignProjects(
      authContext,
      [canonical],
    );

    const name = await this.inboundActivityNameService.computeName(
      authContext,
      data,
    );

    if (!isDefined(name)) {
      return data === payload.data ? payload : { ...payload, data };
    }

    return { ...payload, data: { ...data, name } };
  }
}
