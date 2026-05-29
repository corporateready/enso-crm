import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { type CreateOneResolverArgs } from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';

import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { ProjectRoutingMemberNameService } from 'src/modules/enso/project-routing-member/services/project-routing-member-name.service';

@Injectable()
@WorkspaceQueryHook(`projectRoutingMember.createOne`)
export class ProjectRoutingMemberCreateOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly projectRoutingMemberNameService: ProjectRoutingMemberNameService,
  ) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: CreateOneResolverArgs<Record<string, unknown>>,
  ): Promise<CreateOneResolverArgs<Record<string, unknown>>> {
    if (!isDefined(payload.data)) {
      return payload;
    }

    const name = await this.projectRoutingMemberNameService.computeName(
      authContext,
      payload.data,
    );

    if (!isDefined(name)) {
      return payload;
    }

    return { ...payload, data: { ...payload.data, name } };
  }
}
