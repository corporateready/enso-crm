import { UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { AuthGraphqlApiExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-graphql-api-exception.filter';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { AuthWorkspaceMemberId } from 'src/engine/decorators/auth/auth-workspace-member-id.decorator';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import {
  EnsoCreateManualLeadInput,
  EnsoManualLeadDuplicateCheckDTO,
  EnsoManualLeadDuplicateCheckInput,
  EnsoManualLeadResultDTO,
} from 'src/modules/enso/manual-lead/dtos/manual-lead.dto';
import { ManualLeadDuplicateService } from 'src/modules/enso/manual-lead/services/manual-lead-duplicate.service';
import { ManualLeadService } from 'src/modules/enso/manual-lead/services/manual-lead.service';

// Any signed-in member may add a lead. Both operations write and read past
// record visibility, so the acting member is always taken from the auth
// context, never from the client.
@MetadataResolver()
@UsePipes(ResolverValidationPipe)
@UseFilters(AuthGraphqlApiExceptionFilter)
@UseGuards(WorkspaceAuthGuard, NoPermissionGuard)
export class ManualLeadResolver {
  constructor(
    private readonly manualLeadService: ManualLeadService,
    private readonly manualLeadDuplicateService: ManualLeadDuplicateService,
  ) {}

  @Query(() => EnsoManualLeadDuplicateCheckDTO)
  async ensoManualLeadDuplicateCheck(
    @Args('input') input: EnsoManualLeadDuplicateCheckInput,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthWorkspaceMemberId() workspaceMemberId: string,
  ): Promise<EnsoManualLeadDuplicateCheckDTO> {
    return this.manualLeadDuplicateService.check(
      { workspaceId: workspace.id, ...input },
      workspaceMemberId,
    );
  }

  @Mutation(() => EnsoManualLeadResultDTO)
  async ensoCreateManualLead(
    @Args('input') input: EnsoCreateManualLeadInput,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthWorkspaceMemberId() workspaceMemberId: string,
  ): Promise<EnsoManualLeadResultDTO> {
    return this.manualLeadService.create({
      workspaceId: workspace.id,
      workspaceMemberId,
      input,
    });
  }
}
