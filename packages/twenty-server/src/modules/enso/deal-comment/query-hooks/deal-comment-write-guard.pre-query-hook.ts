import { msg } from '@lingui/core/macro';

import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { type WorkspaceResolverBuilderMutationMethodNames } from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';

import {
  CommonQueryRunnerException,
  CommonQueryRunnerExceptionCode,
} from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { DEAL_COMMENT_GUARDED_OBJECTS } from 'src/modules/enso/deal-comment/deal-comment.constants';

// Every generic write the record API offers. Hook keys are per method and the
// object name can only be wildcarded, so one guard is registered per method and
// filters on the object itself.
const GUARDED_METHOD_NAMES: WorkspaceResolverBuilderMutationMethodNames[] = [
  'createOne',
  'createMany',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
  'destroyOne',
  'destroyMany',
  'restoreOne',
  'restoreMany',
  'mergeMany',
];

// Deal comments and their mentions are written only by DealCommentService,
// which writes through the ORM and so never reaches these hooks. Anything that
// does reach them came through the generic API and would skip the mention rule
// and the visibility it grants, admins and API keys included.
const buildDealCommentWriteGuard = (
  methodName: WorkspaceResolverBuilderMutationMethodNames,
) => {
  @WorkspaceQueryHook(`*.${methodName}`)
  class DealCommentWriteGuard implements WorkspacePreQueryHookInstance {
    async execute<TPayload>(
      _authContext: WorkspaceAuthContext,
      objectName: string,
      payload: TPayload,
    ): Promise<TPayload> {
      if (!DEAL_COMMENT_GUARDED_OBJECTS.has(objectName)) {
        return payload;
      }

      throw new CommonQueryRunnerException(
        `${objectName}.${methodName} is only available through the deal comment actions`,
        CommonQueryRunnerExceptionCode.BAD_REQUEST,
        {
          userFriendlyMessage: msg`Comments can only be posted or deleted from the deal's Comments tab.`,
        },
      );
    }
  }

  return DealCommentWriteGuard;
};

export const DEAL_COMMENT_WRITE_GUARDS = GUARDED_METHOD_NAMES.map(
  buildDealCommentWriteGuard,
);
