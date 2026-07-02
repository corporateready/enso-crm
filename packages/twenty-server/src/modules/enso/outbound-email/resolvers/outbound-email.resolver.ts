import { UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';

import { isDefined } from 'twenty-shared/utils';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { AuthGraphqlApiExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-graphql-api-exception.filter';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthUserWorkspaceId } from 'src/engine/decorators/auth/auth-user-workspace-id.decorator';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { GoogleChatTestResult } from 'src/modules/enso/notifications/dtos/google-chat-test-result.dto';
import { TaskEmailContext } from 'src/modules/enso/outbound-email/dtos/task-email-context.dto';
import { OutboundEmailService } from 'src/modules/enso/outbound-email/services/outbound-email.service';

// Manager 1:1 outbound email actions, mirroring the SMS resolver. Being a
// signed-in member is enough (NoPermissionGuard) — the sender is resolved to the
// manager's OWN connected account (userWorkspaceId), never trusted from the
// client. Consent is advisory: surfaced via hasEmailConsent/consentNote, never
// gating the send (GoogleChatTestResult reused as the {success,error} shape).
@MetadataResolver()
@UsePipes(ResolverValidationPipe)
@UseFilters(AuthGraphqlApiExceptionFilter)
@UseGuards(WorkspaceAuthGuard, NoPermissionGuard)
export class OutboundEmailResolver {
  constructor(private readonly outboundEmailService: OutboundEmailService) {}

  // Preflight for the email compose modal: resolved sender + technical
  // sendability + advisory consent state.
  @Query(() => TaskEmailContext)
  async taskEmailContext(
    @Args('taskId', { type: () => String }) taskId: string,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
  ): Promise<TaskEmailContext> {
    return this.outboundEmailService.getTaskEmailContext({
      workspaceId: workspace.id,
      taskId,
      userWorkspaceId,
    });
  }

  // Manager-initiated 1:1 email from a task. Technical validity + sender are
  // enforced server-side; sends regardless of consent (inform, don't block).
  @Mutation(() => GoogleChatTestResult)
  async sendTaskEmail(
    @Args('taskId', { type: () => String }) taskId: string,
    @Args('subject', { type: () => String }) subject: string,
    @Args('body', { type: () => String }) body: string,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
  ): Promise<GoogleChatTestResult> {
    if (!isDefined(body) || body.trim() === '') {
      return { success: false, error: 'Message is empty.' };
    }

    return this.outboundEmailService.sendTaskEmail({
      workspaceId: workspace.id,
      taskId,
      subject: subject ?? '',
      body,
      userWorkspaceId,
    });
  }

  // Object/standalone email preflight: sender + sendability + advisory consent
  // for a chosen deal + contact.
  @Query(() => TaskEmailContext)
  async personEmailContext(
    @Args('opportunityId', { type: () => String, nullable: true })
    opportunityId: string | null,
    @Args('personId', { type: () => String, nullable: true })
    personId: string | null,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
  ): Promise<TaskEmailContext> {
    return this.outboundEmailService.getRecordEmailContext({
      workspaceId: workspace.id,
      userWorkspaceId,
      ...(isDefined(opportunityId) ? { opportunityId } : {}),
      ...(isDefined(personId) ? { personId } : {}),
    });
  }

  // Object/standalone 1:1 email: same server-side rules as sendTaskEmail, keyed
  // by the chosen deal + contact (logs without a taskId).
  @Mutation(() => GoogleChatTestResult)
  async sendRecordEmail(
    @Args('opportunityId', { type: () => String, nullable: true })
    opportunityId: string | null,
    @Args('personId', { type: () => String, nullable: true })
    personId: string | null,
    @Args('subject', { type: () => String }) subject: string,
    @Args('body', { type: () => String }) body: string,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
  ): Promise<GoogleChatTestResult> {
    if (!isDefined(body) || body.trim() === '') {
      return { success: false, error: 'Message is empty.' };
    }

    return this.outboundEmailService.sendRecordEmail({
      workspaceId: workspace.id,
      userWorkspaceId,
      subject: subject ?? '',
      body,
      ...(isDefined(opportunityId) ? { opportunityId } : {}),
      ...(isDefined(personId) ? { personId } : {}),
    });
  }
}
