import { UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import { Args, Mutation } from '@nestjs/graphql';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { AuthGraphqlApiExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-graphql-api-exception.filter';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { AuthWorkspaceMemberId } from 'src/engine/decorators/auth/auth-workspace-member-id.decorator';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { CallViaPbxResult } from 'src/modules/enso/telephony/dtos/call-via-pbx-result.dto';
import { TelephonyOutboundService } from 'src/modules/enso/telephony/services/telephony-outbound.service';

// Click-to-call. Being a signed-in member is enough (NoPermissionGuard): the
// caller is always the CURRENT member, resolved from the auth context and never
// taken from the client, so a manager can only ever place a call as themselves.
@MetadataResolver()
@UsePipes(ResolverValidationPipe)
@UseFilters(AuthGraphqlApiExceptionFilter)
@UseGuards(WorkspaceAuthGuard, NoPermissionGuard)
export class TelephonyOutboundResolver {
  constructor(
    private readonly telephonyOutboundService: TelephonyOutboundService,
  ) {}

  @Mutation(() => CallViaPbxResult)
  async callViaPbx(
    @Args('personId', { type: () => String, nullable: true })
    personId: string | null,
    @Args('opportunityId', { type: () => String, nullable: true })
    opportunityId: string | null,
    @Args('taskId', { type: () => String, nullable: true })
    taskId: string | null,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthWorkspaceMemberId() workspaceMemberId: string,
  ): Promise<CallViaPbxResult> {
    return this.telephonyOutboundService.callViaPbx({
      workspaceId: workspace.id,
      workspaceMemberId,
      ...(personId ? { personId } : {}),
      ...(opportunityId ? { opportunityId } : {}),
      ...(taskId ? { taskId } : {}),
    });
  }
}
