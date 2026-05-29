import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { type CreateOneResolverArgs } from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';

import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { PersonProjectConsentNameService } from 'src/modules/enso/person-project-consent/services/person-project-consent-name.service';

@Injectable()
@WorkspaceQueryHook(`personProjectConsent.createOne`)
export class PersonProjectConsentCreateOnePreQueryHook
  implements WorkspacePreQueryHookInstance
{
  constructor(
    private readonly personProjectConsentNameService: PersonProjectConsentNameService,
  ) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: CreateOneResolverArgs<Record<string, unknown>>,
  ): Promise<CreateOneResolverArgs<Record<string, unknown>>> {
    if (!isDefined(payload.data)) {
      return payload;
    }

    const name = await this.personProjectConsentNameService.computeName(
      authContext,
      payload.data,
    );

    if (!isDefined(name)) {
      return payload;
    }

    return { ...payload, data: { ...payload.data, name } };
  }
}
