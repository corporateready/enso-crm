import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { type CreateOneResolverArgs } from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';

import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InboundActivityNameService } from 'src/modules/enso/inbound-activity/services/inbound-activity-name.service';
import { withCanonicalUtmMedium } from 'src/modules/enso/inbound-activity/utils/canonicalize-utm-medium.util';

@Injectable()
@WorkspaceQueryHook(`inboundActivity.createOne`)
export class InboundActivityCreateOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly inboundActivityNameService: InboundActivityNameService,
  ) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: CreateOneResolverArgs<Record<string, unknown>>,
  ): Promise<CreateOneResolverArgs<Record<string, unknown>>> {
    if (!isDefined(payload.data)) {
      return payload;
    }

    // Canonicalise here rather than in each intake workflow: every channel lands
    // through this hook, so one alias table covers social DMs, lead ads, forms and
    // calls alike — and n8n stays free to write exactly what the source said.
    const data = withCanonicalUtmMedium(payload.data);

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
