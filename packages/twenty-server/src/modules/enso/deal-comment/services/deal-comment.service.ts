import { Injectable, Logger } from '@nestjs/common';

import { type ActorMetadata, type FullNameMetadata } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { In } from 'typeorm';

import { buildCreatedByFromFullNameMetadata } from 'src/engine/core-modules/actor/utils/build-created-by-from-full-name-metadata.util';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import {
  DEAL_COMMENT_MENTION_OBJECT,
  DEAL_COMMENT_NAME_LENGTH,
  DEAL_COMMENT_OBJECT,
} from 'src/modules/enso/deal-comment/deal-comment.constants';
import { type DealCommentResult } from 'src/modules/enso/deal-comment/dtos/deal-comment-result.dto';
import { buildDealCommentTimelineSegments } from 'src/modules/enso/deal-comment/utils/build-deal-comment-timeline-segments.util';
import { validateDealCommentInput } from 'src/modules/enso/deal-comment/utils/validate-deal-comment-input.util';
import { type ManagerNotifyJobData } from 'src/modules/enso/lead-pipeline/jobs/lead-pipeline-job.types';
import { ManagerNotifyJob } from 'src/modules/enso/lead-pipeline/jobs/manager-notify.job';
import { EnsoViewerScopeService } from 'src/modules/enso/record-visibility/services/enso-viewer-scope.service';
import { buildEnsoTimelineInserts } from 'src/modules/enso/timeline/enso-timeline.util';

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

// The deal's free-text thread. Every write goes through here rather than the
// generic record API (see DealCommentWriteGuard), because a mention lets the
// colleague read the deal: it must only ever be created alongside a real
// comment by someone who can see that deal.
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
    @InjectMessageQueue(MessageQueue.ensoLeadPipelineQueue)
    private readonly messageQueueService: MessageQueueService,
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
          if (mentionedMembers.length > 0) {
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
          }
        } catch (error) {
          // The author tagged someone so they would be told; a comment that
          // silently lost its mentions would leave them waiting for nothing.
          this.logger.error(
            `Could not save mentions for comment ${comment.id}: ${
              (error as Error)?.message
            }`,
          );
          await commentRepository.softDelete({ id: comment.id });

          return { success: false, error: 'Could not post the comment.' };
        }

        await this.writeTimelineEntry({
          workspaceId,
          opportunityId,
          authorWorkspaceMemberId: author.id,
          body: validated.body,
          mentionedMemberNames: mentionedMembers.map(formatMemberName),
        });

        await this.notifyMentionedMembers({
          workspaceId,
          commentId: comment.id,
          mentionedWorkspaceMemberIds: mentionedMembers.map(
            (member) => member.id,
          ),
        });

        return { success: true, commentId: comment.id };
      },
      buildSystemAuthContext(workspaceId),
    );
  }

  // Best-effort: the comment is already saved, and a missing timeline line is
  // not a reason to tell the author it failed.
  private async writeTimelineEntry({
    workspaceId,
    opportunityId,
    authorWorkspaceMemberId,
    body,
    mentionedMemberNames,
  }: {
    workspaceId: string;
    opportunityId: string;
    authorWorkspaceMemberId: string;
    body: string;
    mentionedMemberNames: string[];
  }): Promise<void> {
    try {
      const timelineRepository =
        await this.globalWorkspaceOrmManager.getRepository<
          Record<string, unknown>
        >(workspaceId, 'timelineActivity', {
          shouldBypassPermissionChecks: true,
        });

      await timelineRepository.insert(
        buildEnsoTimelineInserts({
          action: 'comment-posted',
          target: { opportunityId },
          segments: buildDealCommentTimelineSegments({
            body,
            mentionedMemberNames,
          }),
          workspaceMemberId: authorWorkspaceMemberId,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Could not write the timeline entry for a comment on ${opportunityId}: ${
          (error as Error)?.message
        }`,
      );
    }
  }

  // Queued so a slow Google Chat post never holds up posting the comment. The
  // worker re-reads the comment, so one deleted in the meantime notifies no one.
  private async notifyMentionedMembers({
    workspaceId,
    commentId,
    mentionedWorkspaceMemberIds,
  }: {
    workspaceId: string;
    commentId: string;
    mentionedWorkspaceMemberIds: string[];
  }): Promise<void> {
    for (const managerId of mentionedWorkspaceMemberIds) {
      try {
        await this.messageQueueService.add<ManagerNotifyJobData>(
          ManagerNotifyJob.name,
          { workspaceId, kind: 'comment_mention', commentId, managerId },
        );
      } catch (error) {
        this.logger.warn(
          `Could not queue the mention notification for comment ${commentId}: ${
            (error as Error)?.message
          }`,
        );
      }
    }
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
