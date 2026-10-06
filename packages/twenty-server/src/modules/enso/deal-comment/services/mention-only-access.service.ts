import { Injectable } from '@nestjs/common';

import { msg } from '@lingui/core/macro';
import { isDefined } from 'twenty-shared/utils';

import {
  CommonQueryRunnerException,
  CommonQueryRunnerExceptionCode,
} from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { isUserAuthContext } from 'src/engine/core-modules/auth/guards/is-user-auth-context.guard';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { DEAL_COMMENT_MENTION_OBJECT } from 'src/modules/enso/deal-comment/deal-comment.constants';
import { EnsoViewerScopeService } from 'src/modules/enso/record-visibility/services/enso-viewer-scope.service';

type OpportunityRow = {
  id: string;
  ownerId: string | null;
  pointOfContactId: string | null;
};
type MentionRow = {
  id: string;
  opportunityId: string | null;
  mentionedMemberId: string | null;
};
type AssignmentRow = {
  id: string;
  personId: string | null;
  managerId: string | null;
};

type Repositories = {
  opportunityRepository: WorkspaceRepository<OpportunityRow>;
  mentionRepository: WorkspaceRepository<MentionRow>;
  assignmentRepository: WorkspaceRepository<AssignmentRow>;
};

// A scoped manager tagged on someone else's deal can read it, but the write
// rules still say no. Without this the refusal surfaces as Twenty's generic
// "This record does not exist or has been deleted." for a record that is open
// on their screen. This only replaces that message; the rules themselves
// decide, so anything not caught here is still refused.
@Injectable()
export class MentionOnlyAccessService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly ensoViewerScopeService: EnsoViewerScopeService,
  ) {}

  async assertNotMentionOnly({
    authContext,
    objectName,
    recordId,
  }: {
    authContext: WorkspaceAuthContext;
    objectName: 'opportunity' | 'person';
    recordId: string | undefined;
  }): Promise<void> {
    if (!isDefined(recordId) || !isUserAuthContext(authContext)) {
      return;
    }

    const workspaceId = authContext.workspace.id;
    const me = authContext.workspaceMemberId;

    if (
      !(await this.ensoViewerScopeService.isViewerScoped({
        workspaceId,
        userWorkspaceId: authContext.userWorkspaceId,
      }))
    ) {
      return;
    }

    const isMentionOnly =
      objectName === 'opportunity'
        ? await this.isMentionOnlyDeal(workspaceId, me, recordId)
        : await this.isMentionOnlyContact(workspaceId, me, recordId);

    if (!isMentionOnly) {
      return;
    }

    throw new CommonQueryRunnerException(
      `${objectName} ${recordId} is readable through a comment mention only`,
      CommonQueryRunnerExceptionCode.BAD_REQUEST,
      {
        userFriendlyMessage:
          objectName === 'opportunity'
            ? msg`You can see this deal because a colleague tagged you in a comment. Only its owner can change it.`
            : msg`You can see this contact because a colleague tagged you on one of their deals. Only their manager can change it.`,
      },
    );
  }

  private async isMentionOnlyDeal(
    workspaceId: string,
    me: string,
    opportunityId: string,
  ): Promise<boolean> {
    return this.withRepositories(
      workspaceId,
      async ({ opportunityRepository, mentionRepository }) => {
        const opportunity = await opportunityRepository.findOne({
          where: { id: opportunityId },
        });

        if (!isDefined(opportunity) || opportunity.ownerId === me) {
          return false;
        }

        return mentionRepository.exists({
          where: { opportunityId, mentionedMemberId: me },
        });
      },
    );
  }

  // Mirrors how the read rule lends a contact: the point of contact of a deal
  // the member was tagged on, when nothing else makes the contact theirs.
  private async isMentionOnlyContact(
    workspaceId: string,
    me: string,
    personId: string,
  ): Promise<boolean> {
    return this.withRepositories(
      workspaceId,
      async ({
        opportunityRepository,
        mentionRepository,
        assignmentRepository,
      }) => {
        const [isAssigned, ownsADeal] = await Promise.all([
          assignmentRepository.exists({
            where: { personId, managerId: me },
          }),
          opportunityRepository.exists({
            where: { pointOfContactId: personId, ownerId: me },
          }),
        ]);

        if (isAssigned || ownsADeal) {
          return false;
        }

        const dealsOfContact = await opportunityRepository.find({
          where: { pointOfContactId: personId },
          select: { id: true },
        });

        for (const deal of dealsOfContact) {
          if (
            await mentionRepository.exists({
              where: { opportunityId: deal.id, mentionedMemberId: me },
            })
          ) {
            return true;
          }
        }

        return false;
      },
    );
  }

  private async withRepositories<TResult>(
    workspaceId: string,
    callback: (repositories: Repositories) => Promise<TResult>,
  ): Promise<TResult | false> {
    try {
      return await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const options = { shouldBypassPermissionChecks: true } as const;

          return callback({
            opportunityRepository:
              await this.globalWorkspaceOrmManager.getRepository<OpportunityRow>(
                workspaceId,
                'opportunity',
                options,
              ),
            mentionRepository:
              await this.globalWorkspaceOrmManager.getRepository<MentionRow>(
                workspaceId,
                DEAL_COMMENT_MENTION_OBJECT,
                options,
              ),
            assignmentRepository:
              await this.globalWorkspaceOrmManager.getRepository<AssignmentRow>(
                workspaceId,
                'personProjectAssignment',
                options,
              ),
          });
        },
        buildSystemAuthContext(workspaceId),
      );
    } catch {
      // A missing mention object (not provisioned yet) or any lookup failure
      // just leaves the generic refusal in place.
      return false;
    }
  }
}
