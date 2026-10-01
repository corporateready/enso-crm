import { Injectable, Logger } from '@nestjs/common';

import { type ActorMetadata, type FullNameMetadata } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { In } from 'typeorm';

import { buildCreatedByFromFullNameMetadata } from 'src/engine/core-modules/actor/utils/build-created-by-from-full-name-metadata.util';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import {
  DEAL_COMMENT_MENTION_OBJECT,
  DEAL_COMMENT_NAME_LENGTH,
  DEAL_COMMENT_OBJECT,
} from 'src/modules/enso/deal-comment/deal-comment.constants';
import { type DealCommentResult } from 'src/modules/enso/deal-comment/dtos/deal-comment-result.dto';
import { validateDealCommentInput } from 'src/modules/enso/deal-comment/utils/validate-deal-comment-input.util';
import { EnsoViewerScopeService } from 'src/modules/enso/record-visibility/services/enso-viewer-scope.service';

type WorkspaceMemberRow = {
  id: string;
  name: FullNameMetadata;
};

type OpportunityRow = {
  id: string;
  ownerId: string | null;
};

type DealCommentRow = {
  id: string;
  name?: string;
  body?: string;
  opportunityId?: string;
  createdBy?: ActorMetadata;
  updatedBy?: ActorMetadata;
};

type DealCommentMentionRow = {
  id: string;
  name?: string;
  dealCommentId?: string;
  opportunityId?: string;
  mentionedMemberId?: string;
  createdBy?: ActorMetadata;
  updatedBy?: ActorMetadata;
};

const formatMemberName = (member: WorkspaceMemberRow) =>
  `${member.name?.firstName ?? ''} ${member.name?.lastName ?? ''}`.trim();

// Internal discussion on a deal. Every write goes through here rather than the
// generic record API (see DealCommentWriteGuard), because a comment and its
// mentions only make sense together: a comment with no mention addresses no
// one, and a mention with no comment would grant visibility of a deal for
// nothing.
//
// Writes bypass permission checks, so this service is the one place that
// decides who may comment. A scoped manager may comment where they can see the
// deal: deals they own, and deals someone mentioned them on.
@Injectable()
export class DealCommentService {
  private readonly logger = new Logger(DealCommentService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly ensoViewerScopeService: EnsoViewerScopeService,
  ) {}

  async createComment({
    workspaceId,
    userWorkspaceId,
    authorWorkspaceMemberId,
    opportunityId,
    body,
    mentionedWorkspaceMemberIds,
  }: {
    workspaceId: string;
    userWorkspaceId: string;
    authorWorkspaceMemberId: string;
    opportunityId: string;
    body: string;
    mentionedWorkspaceMemberIds: string[];
  }): Promise<DealCommentResult> {
    const validated = validateDealCommentInput({
      body,
      mentionedWorkspaceMemberIds,
      authorWorkspaceMemberId,
    });

    if (!validated.isValid) {
      return { success: false, error: validated.error };
    }

    const isViewerScoped = await this.ensoViewerScopeService.isViewerScoped({
      workspaceId,
      userWorkspaceId,
    });

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const opportunityRepository =
          await this.globalWorkspaceOrmManager.getRepository<OpportunityRow>(
            workspaceId,
            'opportunity',
            { shouldBypassPermissionChecks: true },
          );
        const workspaceMemberRepository =
          await this.globalWorkspaceOrmManager.getRepository<WorkspaceMemberRow>(
            workspaceId,
            'workspaceMember',
            { shouldBypassPermissionChecks: true },
          );
        const commentRepository =
          await this.globalWorkspaceOrmManager.getRepository<DealCommentRow>(
            workspaceId,
            DEAL_COMMENT_OBJECT,
            { shouldBypassPermissionChecks: true },
          );
        const mentionRepository =
          await this.globalWorkspaceOrmManager.getRepository<DealCommentMentionRow>(
            workspaceId,
            DEAL_COMMENT_MENTION_OBJECT,
            { shouldBypassPermissionChecks: true },
          );

        const opportunity = await opportunityRepository.findOne({
          where: { id: opportunityId },
        });

        if (!isDefined(opportunity)) {
          return { success: false, error: 'This deal no longer exists.' };
        }

        if (
          isViewerScoped &&
          opportunity.ownerId !== authorWorkspaceMemberId &&
          !(await mentionRepository.exists({
            where: {
              opportunityId,
              mentionedMemberId: authorWorkspaceMemberId,
            },
          }))
        ) {
          return {
            success: false,
            error: 'You can only comment on deals you can see.',
          };
        }

        const members = await workspaceMemberRepository.find({
          where: {
            id: In([
              authorWorkspaceMemberId,
              ...validated.mentionedWorkspaceMemberIds,
            ]),
          },
        });
        const membersById = new Map(
          members.map((member) => [member.id, member]),
        );
        const author = membersById.get(authorWorkspaceMemberId);

        if (!isDefined(author)) {
          return { success: false, error: 'Could not identify you.' };
        }

        const mentionedMembers = validated.mentionedWorkspaceMemberIds
          .map((workspaceMemberId) => membersById.get(workspaceMemberId))
          .filter(isDefined);

        if (
          mentionedMembers.length !==
          validated.mentionedWorkspaceMemberIds.length
        ) {
          return {
            success: false,
            error: 'Someone you mentioned is no longer in the workspace.',
          };
        }

        // The rows are written with permission checks off, which also skips the
        // resolver that stamps the actor — so stamp the real author, not the
        // system, or every comment would read as written by ENSO CRM.
        const authorActor = buildCreatedByFromFullNameMetadata({
          fullNameMetadata: author.name,
          workspaceMemberId: author.id,
        });

        const comment = await commentRepository.save({
          name: validated.body.slice(0, DEAL_COMMENT_NAME_LENGTH),
          body: validated.body,
          opportunityId,
          createdBy: authorActor,
          updatedBy: authorActor,
        });

        try {
          await mentionRepository.insert(
            mentionedMembers.map((member) => ({
              name: formatMemberName(member),
              dealCommentId: comment.id,
              opportunityId,
              mentionedMemberId: member.id,
              createdBy: authorActor,
              updatedBy: authorActor,
            })),
          );
        } catch (error) {
          // A comment without its mentions breaks the rule this service exists
          // to keep, so take it back down rather than leave it half-written.
          this.logger.error(
            `Could not save mentions for comment ${comment.id}: ${
              (error as Error)?.message
            }`,
          );
          await commentRepository.softDelete({ id: comment.id });

          return { success: false, error: 'Could not post the comment.' };
        }

        return { success: true, commentId: comment.id };
      },
      buildSystemAuthContext(workspaceId),
    );
  }

  // Only the author can take a comment back. Its mentions go with it, so a
  // mistaken tag stops granting the colleague access to the deal.
  async deleteComment({
    workspaceId,
    authorWorkspaceMemberId,
    commentId,
  }: {
    workspaceId: string;
    authorWorkspaceMemberId: string;
    commentId: string;
  }): Promise<DealCommentResult> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const commentRepository =
          await this.globalWorkspaceOrmManager.getRepository<DealCommentRow>(
            workspaceId,
            DEAL_COMMENT_OBJECT,
            { shouldBypassPermissionChecks: true },
          );
        const mentionRepository =
          await this.globalWorkspaceOrmManager.getRepository<DealCommentMentionRow>(
            workspaceId,
            DEAL_COMMENT_MENTION_OBJECT,
            { shouldBypassPermissionChecks: true },
          );

        const comment = await commentRepository.findOne({
          where: { id: commentId },
        });

        if (!isDefined(comment)) {
          return { success: false, error: 'This comment no longer exists.' };
        }

        if (comment.createdBy?.workspaceMemberId !== authorWorkspaceMemberId) {
          return {
            success: false,
            error: 'Only the author can delete a comment.',
          };
        }

        await mentionRepository.softDelete({ dealCommentId: commentId });
        await commentRepository.softDelete({ id: commentId });

        return { success: true, commentId };
      },
      buildSystemAuthContext(workspaceId),
    );
  }
}
