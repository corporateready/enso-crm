import { UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import { Args, Int, Mutation, Query } from '@nestjs/graphql';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { AuthGraphqlApiExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-graphql-api-exception.filter';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthUser } from 'src/engine/decorators/auth/auth-user.decorator';
import { AuthUserWorkspaceId } from 'src/engine/decorators/auth/auth-user-workspace-id.decorator';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { PermissionFlagType } from 'twenty-shared/constants';
import { isDefined } from 'twenty-shared/utils';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { ENSO_HIDDEN_NAVIGATION_OBJECT_NAME_SINGULARS } from 'src/modules/enso/record-visibility/constants/enso-hidden-navigation-objects.constant';
import {
  EnsoColumnWidthDTO,
  EnsoDefaultViewDTO,
  EnsoDefaultViewInput,
  EnsoViewerScopeDTO,
} from 'src/modules/enso/record-visibility/dtos/enso-viewer-scope.dto';
import { EnsoColumnWidthsService } from 'src/modules/enso/column-widths/services/enso-column-widths.service';
import { type EnsoUserColumnWidths } from 'src/modules/enso/column-widths/utils/enso-column-widths.util';
import { EnsoDefaultViewsService } from 'src/modules/enso/default-views/services/enso-default-views.service';
import { EnsoViewerScopeService } from 'src/modules/enso/record-visibility/services/enso-viewer-scope.service';

// The store nests widths per view; GraphQL gets one flat list, which is what
// the client indexes anyway.
const flattenEnsoColumnWidths = (
  widths: EnsoUserColumnWidths,
): EnsoColumnWidthDTO[] =>
  Object.entries(widths).flatMap(([viewId, viewWidths]) =>
    Object.entries(viewWidths).map(([fieldMetadataId, size]) => ({
      viewId,
      fieldMetadataId,
      size,
    })),
  );

// Lets the client know whether it is rendering for someone limited to their own
// records, and what to leave out of their sidebar. Reveals nothing about anyone
// else, so being signed in is enough.
//
// API keys have no user context, so `allowUndefined` keeps this from throwing
// for them; they simply come back unscoped.
@MetadataResolver()
@UsePipes(ResolverValidationPipe)
@UseFilters(AuthGraphqlApiExceptionFilter)
@UseGuards(WorkspaceAuthGuard, NoPermissionGuard)
export class EnsoViewerScopeResolver {
  constructor(
    private readonly ensoViewerScopeService: EnsoViewerScopeService,
    private readonly ensoDefaultViewsService: EnsoDefaultViewsService,
    private readonly ensoColumnWidthsService: EnsoColumnWidthsService,
  ) {}

  @Query(() => EnsoViewerScopeDTO)
  async ensoViewerScope(
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId({ allowUndefined: true })
    userWorkspaceId: string | undefined,
    @AuthUser({ allowUndefined: true }) user: UserEntity | undefined,
  ): Promise<EnsoViewerScopeDTO> {
    const isRecordScoped = await this.ensoViewerScopeService.isViewerScoped({
      workspaceId: workspace.id,
      userWorkspaceId,
    });

    // Default views are keyed on the ROLE, not on being scoped: an admin role
    // may want its own list layouts too.
    const roleId = await this.ensoViewerScopeService.getViewerRoleId({
      workspaceId: workspace.id,
      userWorkspaceId,
    });

    const { defaultViewIdByObjectMetadataId, version } = roleId
      ? await this.ensoDefaultViewsService.getRoleDefaultViews({
          workspaceId: workspace.id,
          roleId,
        })
      : { defaultViewIdByObjectMetadataId: {}, version: null };

    // An API key has no person behind it, so it simply has no own defaults.
    const personalDefaultViews = user
      ? await this.ensoDefaultViewsService.getUserDefaultViews({
          workspaceId: workspace.id,
          userId: user.id,
        })
      : {};

    const personalColumnWidths = user
      ? await this.ensoColumnWidthsService.getUserColumnWidths({
          workspaceId: workspace.id,
          userId: user.id,
        })
      : {};

    return {
      isRecordScoped,
      hiddenNavigationObjectNameSingulars: isRecordScoped
        ? ENSO_HIDDEN_NAVIGATION_OBJECT_NAME_SINGULARS
        : [],
      defaultViews: Object.entries(defaultViewIdByObjectMetadataId).map(
        ([objectMetadataId, viewId]) => ({ objectMetadataId, viewId }),
      ),
      defaultViewsVersion: version,
      personalDefaultViews: Object.entries(personalDefaultViews).map(
        ([objectMetadataId, viewId]) => ({ objectMetadataId, viewId }),
      ),
      personalColumnWidths: flattenEnsoColumnWidths(personalColumnWidths),
    };
  }

  // Setting your OWN landing view is not an administrative act, so unlike the
  // role mutation this is gated on nothing but being a signed-in person.
  // Passing a null viewId clears it and hands the object back to the role
  // default.
  @Mutation(() => [EnsoDefaultViewDTO])
  async ensoSetMyDefaultView(
    @Args('objectMetadataId', { type: () => String }) objectMetadataId: string,
    @Args('viewId', { type: () => String, nullable: true })
    viewId: string | null,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUser() user: UserEntity,
  ): Promise<EnsoDefaultViewDTO[]> {
    const current = await this.ensoDefaultViewsService.getUserDefaultViews({
      workspaceId: workspace.id,
      userId: user.id,
    });

    const next = { ...current };

    if (isDefined(viewId)) {
      next[objectMetadataId] = viewId;
    } else {
      delete next[objectMetadataId];
    }

    await this.ensoDefaultViewsService.setUserDefaultViews({
      workspaceId: workspace.id,
      userId: user.id,
      defaultViewIdByObjectMetadataId: next,
    });

    return Object.entries(next).map(([objectId, view]) => ({
      objectMetadataId: objectId,
      viewId: view,
    }));
  }

  // Remembering how wide YOU made a column is not an administrative act either:
  // it writes only to this person's own row, never to the shared view, so a
  // member who cannot edit a role view can still keep their own layout.
  // A null size clears the override and hands the column back to the view.
  @Mutation(() => [EnsoColumnWidthDTO])
  async ensoSetMyColumnWidth(
    @Args('viewId', { type: () => String }) viewId: string,
    @Args('fieldMetadataId', { type: () => String }) fieldMetadataId: string,
    @Args('size', { type: () => Int, nullable: true }) size: number | null,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUser() user: UserEntity,
  ): Promise<EnsoColumnWidthDTO[]> {
    const nextWidths = await this.ensoColumnWidthsService.setUserColumnWidth({
      workspaceId: workspace.id,
      userId: user.id,
      viewId,
      fieldMetadataId,
      size,
    });

    return flattenEnsoColumnWidths(nextWidths);
  }

  // Configuring what a whole ROLE lands on is an administrative act, so unlike
  // the read above this is gated on settings permissions rather than merely
  // being signed in.
  @Mutation(() => [EnsoDefaultViewDTO])
  @UseGuards(SettingsPermissionGuard(PermissionFlagType.ROLES))
  async ensoSetRoleDefaultViews(
    @Args('roleId', { type: () => String }) roleId: string,
    @Args('defaultViews', { type: () => [EnsoDefaultViewInput] })
    defaultViews: EnsoDefaultViewInput[],
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<EnsoDefaultViewDTO[]> {
    await this.ensoDefaultViewsService.setRoleDefaultViews({
      workspaceId: workspace.id,
      roleId,
      defaultViewIdByObjectMetadataId: Object.fromEntries(
        defaultViews.map((defaultView) => [
          defaultView.objectMetadataId,
          defaultView.viewId,
        ]),
      ),
    });

    return defaultViews;
  }
}
