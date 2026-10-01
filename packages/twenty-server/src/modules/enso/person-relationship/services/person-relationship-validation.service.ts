import { Injectable } from '@nestjs/common';

import { msg } from '@lingui/core/macro';
import { isDefined } from 'twenty-shared/utils';

import {
  CommonQueryRunnerException,
  CommonQueryRunnerExceptionCode,
} from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import {
  findLinkValidationError,
  type RelationshipRow,
} from 'src/modules/enso/person-relationship/utils/plan-partner-sync.util';

type LinkCandidate = {
  id?: string;
  personId?: string | null;
  relatedPersonId?: string | null;
};

// Rejects family links that would show a person twice on a Family card (the
// pair is already linked, from either side) or link a person to themselves.
// Runs before the write, so the manager gets the message instead of a silent
// duplicate.
@Injectable()
export class PersonRelationshipValidationService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  // On update the payload carries only the changed fields; fill the rest from
  // the stored row before validating.
  async assertCanUpdate(
    authContext: WorkspaceAuthContext,
    id: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    if (!('personId' in data) && !('relatedPersonId' in data)) return;

    const workspaceId = authContext.workspace?.id;

    if (!isDefined(workspaceId)) return;

    const existing: RelationshipRow | null = await this.withRepository(
      workspaceId,
      (repository) => repository.findOne({ where: { id } }),
    );

    await this.assertCanLink(authContext, {
      id,
      personId:
        'personId' in data
          ? (data.personId as string | null)
          : existing?.personId,
      relatedPersonId:
        'relatedPersonId' in data
          ? (data.relatedPersonId as string | null)
          : existing?.relatedPersonId,
    });
  }

  async assertCanLink(
    authContext: WorkspaceAuthContext,
    candidate: LinkCandidate,
  ): Promise<void> {
    const workspaceId = authContext.workspace?.id;
    const { personId, relatedPersonId } = candidate;

    if (
      !isDefined(workspaceId) ||
      !isDefined(personId) ||
      !isDefined(relatedPersonId)
    ) {
      return;
    }

    const linksBetweenThePair: RelationshipRow[] =
      personId === relatedPersonId
        ? []
        : await this.withRepository(workspaceId, (repository) =>
            repository.find({
              where: [
                { personId, relatedPersonId },
                { personId: relatedPersonId, relatedPersonId: personId },
              ],
            }),
          );

    const ownRow = isDefined(candidate.id)
      ? linksBetweenThePair.find((row) => row.id === candidate.id)
      : undefined;

    const error = findLinkValidationError(
      { ...candidate, mirrorOfId: ownRow?.mirrorOfId },
      linksBetweenThePair,
    );

    if (error === 'SELF_LINK') {
      throw new CommonQueryRunnerException(
        'A person cannot be linked to themselves',
        CommonQueryRunnerExceptionCode.INVALID_ARGS_DATA,
        {
          userFriendlyMessage: msg`A person can't be added to their own family.`,
        },
      );
    }

    if (error === 'DUPLICATE_LINK') {
      throw new CommonQueryRunnerException(
        'These two people are already linked',
        CommonQueryRunnerExceptionCode.INVALID_ARGS_DATA,
        {
          userFriendlyMessage: msg`These two people are already linked as family. Edit the existing link instead.`,
        },
      );
    }
  }

  private async withRepository<TResult>(
    workspaceId: string,
    callback: (repository: any) => Promise<TResult>,
  ): Promise<TResult> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository =
          await this.globalWorkspaceOrmManager.getRepository<any>(
            workspaceId,
            'personRelationship',
            { shouldBypassPermissionChecks: true },
          );

        return callback(repository);
      },
      buildSystemAuthContext(workspaceId),
    );
  }
}
