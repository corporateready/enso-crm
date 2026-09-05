import { UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import { Args, Query } from '@nestjs/graphql';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { AuthGraphqlApiExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-graphql-api-exception.filter';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { AuthUserWorkspaceId } from 'src/engine/decorators/auth/auth-user-workspace-id.decorator';
import { AuthWorkspaceMemberId } from 'src/engine/decorators/auth/auth-workspace-member-id.decorator';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { EnsoLeadLookupResultDTO } from 'src/modules/enso/record-lookup/dtos/enso-lead-lookup-match.dto';
import { EnsoLeadLookupService } from 'src/modules/enso/record-lookup/services/enso-lead-lookup.service';

// Being a signed-in member is enough (NoPermissionGuard). The lookup reads past
// record visibility on purpose, but it returns no record and no contact detail,
// and the viewer is always resolved from the auth context, never from the
// client, so nobody can run a lookup as somebody else.
@MetadataResolver()
@UsePipes(ResolverValidationPipe)
@UseFilters(AuthGraphqlApiExceptionFilter)
@UseGuards(WorkspaceAuthGuard, NoPermissionGuard)
export class EnsoLeadLookupResolver {
  constructor(private readonly ensoLeadLookupService: EnsoLeadLookupService) {}

  @Query(() => EnsoLeadLookupResultDTO)
  async ensoLeadLookup(
    @Args('searchTerm', { type: () => String }) searchTerm: string,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthWorkspaceMemberId() workspaceMemberId: string,
    @AuthUserWorkspaceId() userWorkspaceId: string,
  ): Promise<EnsoLeadLookupResultDTO> {
    return this.ensoLeadLookupService.lookup({
      workspaceId: workspace.id,
      workspaceMemberId,
      userWorkspaceId,
      searchTerm,
    });
  }
}
