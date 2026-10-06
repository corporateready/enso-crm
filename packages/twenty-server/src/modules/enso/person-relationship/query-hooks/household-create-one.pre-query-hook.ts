import { Injectable } from '@nestjs/common';

import { msg } from '@lingui/core/macro';

import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';

import {
  CommonQueryRunnerException,
  CommonQueryRunnerExceptionCode,
} from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';

// A family (household) exists because people are linked; HouseholdSyncService
// creates it through the repository. Created through the API it would only be
// an empty name, so the API refuses — the UI already hides "New Family".
@Injectable()
@WorkspaceQueryHook(`household.createOne`)
export class HouseholdCreateOnePreQueryHook implements WorkspacePreQueryHookInstance {
  async execute(): Promise<never> {
    throw new CommonQueryRunnerException(
      'Households are derived from family links',
      CommonQueryRunnerExceptionCode.INVALID_ARGS_DATA,
      {
        userFriendlyMessage: msg`Families are created automatically: add a relative on a person's Family tab.`,
      },
    );
  }
}
