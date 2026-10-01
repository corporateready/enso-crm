import { UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import { Args, Mutation } from '@nestjs/graphql';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { AuthGraphqlApiExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-graphql-api-exception.filter';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthUserWorkspaceId } from 'src/engine/decorators/auth/auth-user-workspace-id.decorator';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { AuthWorkspaceMemberId } from 'src/engine/decorators/auth/auth-workspace-member-id.decorator';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { DealCommentResult } from 'src/modules/enso/deal-comment/dtos/deal-comment-result.dto';
import { DealCommentService } from 'src/modules/enso/deal-comment/services/deal-comment.service';

// The only way to write a deal comment. Being a signed-in member is enough to
// call it; whether this member may comment on this deal is decided in
// DealCommentService, from who they are rather than anything the client sends.
@MetadataResolver()
@UsePipes(ResolverValidationPipe)
@UseFilters(AuthGraphqlApiExceptionFilter)
@UseGuards(WorkspaceAuthGuard, NoPermissionGuard)
export class DealCommentResolver {
  constructor(private readonly dealCommentService: DealCommentService) {}

  @Mutation(() => DealCommentResult)
  async createDealComment(
    @Args('opportunityId', { type: () => String }) opportunityId: string,
    @Args('body', { type: () => String }) body: string,
    @Args('mentionedWorkspaceMemberIds', { type: () => [String] })
    mentionedWorkspaceMemberIds: string[],
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
    @AuthWorkspaceMemberId() workspaceMemberId: string,
  ): Promise<DealCommentResult> {
    return this.dealCommentService.createComment({
      workspaceId: workspace.id,
      userWorkspaceId,
      authorWorkspaceMemberId: workspaceMemberId,
      opportunityId,
      body,
      mentionedWorkspaceMemberIds,
    });
  }

  @Mutation(() => DealCommentResult)
  async deleteDealComment(
    @Args('commentId', { type: () => String }) commentId: string,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthWorkspaceMemberId() workspaceMemberId: string,
  ): Promise<DealCommentResult> {
    return this.dealCommentService.deleteComment({
      workspaceId: workspace.id,
      authorWorkspaceMemberId: workspaceMemberId,
      commentId,
    });
  }
}
