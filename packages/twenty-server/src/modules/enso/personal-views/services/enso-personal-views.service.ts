import { Injectable, Logger } from '@nestjs/common';

import { ViewVisibility } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { KeyValuePairType } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { KeyValuePairService } from 'src/engine/core-modules/key-value-pair/key-value-pair.service';
import { UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { ViewFieldService } from 'src/engine/metadata-modules/view-field/services/view-field.service';
import { ViewFilterService } from 'src/engine/metadata-modules/view-filter/services/view-filter.service';
import { ViewSortService } from 'src/engine/metadata-modules/view-sort/services/view-sort.service';
import { ViewService } from 'src/engine/metadata-modules/view/services/view.service';
import {
  ensoRoleViewTemplatesKey,
  ensoViewCopiesKey,
} from 'src/modules/enso/personal-views/constants/enso-personal-views.constants';

// objectMetadataId → ordered template view ids.
export type EnsoRoleViewTemplates = Record<string, string[]>;

// templateViewId → the member's copy.
export type EnsoViewCopies = Record<string, string>;

// Gives every member of a role their OWN copies of a set of prepared views.
//
// A shared (WORKSPACE) view can only be changed by a role holding the VIEWS
// permission, and a change to it reaches everyone. Members need to reshape
// their views freely without touching anyone else's, and the only view Twenty
// lets a person without VIEWS change is an UNLISTED one they created — so each
// member gets UNLISTED copies of the role's templates, owned by them.
//
// The templates themselves stay workspace views that an admin maintains. A copy
// is a snapshot: later template edits do not flow into copies already made.
@Injectable()
export class EnsoPersonalViewsService {
  private readonly logger = new Logger(EnsoPersonalViewsService.name);

  // Copying runs several workspace migrations per view, so a second request for
  // the same member while the first is still running must not copy again.
  private readonly inFlightByUserWorkspaceId = new Map<
    string,
    Promise<EnsoViewCopies>
  >();

  constructor(
    private readonly keyValuePairService: KeyValuePairService,
    private readonly userRoleService: UserRoleService,
    private readonly viewService: ViewService,
    private readonly viewFieldService: ViewFieldService,
    private readonly viewFilterService: ViewFilterService,
    private readonly viewSortService: ViewSortService,
  ) {}

  async getRoleViewTemplates({
    workspaceId,
    roleId,
  }: {
    workspaceId: string;
    roleId: string;
  }): Promise<EnsoRoleViewTemplates> {
    const stored = await this.readValue({
      workspaceId,
      key: ensoRoleViewTemplatesKey(roleId),
    });

    if (!isDefined(stored) || typeof stored !== 'object') {
      return {};
    }

    return Object.fromEntries(
      Object.entries(stored as Record<string, unknown>)
        .filter((entry): entry is [string, unknown[]] =>
          Array.isArray(entry[1]),
        )
        .map(([objectMetadataId, viewIds]) => [
          objectMetadataId,
          viewIds.filter(
            (viewId): viewId is string => typeof viewId === 'string',
          ),
        ]),
    );
  }

  async setRoleViewTemplates({
    workspaceId,
    roleId,
    templates,
  }: {
    workspaceId: string;
    roleId: string;
    templates: EnsoRoleViewTemplates;
  }): Promise<void> {
    await this.keyValuePairService.set({
      userId: null,
      workspaceId,
      key: ensoRoleViewTemplatesKey(roleId),
      value: templates,
      type: KeyValuePairType.USER_VARIABLE,
    });
  }

  async getViewCopies({
    workspaceId,
    userWorkspaceId,
  }: {
    workspaceId: string;
    userWorkspaceId: string;
  }): Promise<EnsoViewCopies> {
    const stored = await this.readValue({
      workspaceId,
      key: ensoViewCopiesKey(userWorkspaceId),
    });

    if (!isDefined(stored) || typeof stored !== 'object') {
      return {};
    }

    return Object.fromEntries(
      Object.entries(stored as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  }

  hasMissingCopies({
    templates,
    copies,
  }: {
    templates: EnsoRoleViewTemplates;
    copies: EnsoViewCopies;
  }): boolean {
    return Object.values(templates)
      .flat()
      .some((templateViewId) => !isDefined(copies[templateViewId]));
  }

  // Copies every template this member does not have a copy of yet. Safe to call
  // repeatedly: each copy is recorded as soon as it exists, so an interrupted
  // run resumes where it stopped instead of duplicating.
  async ensureViewCopies({
    workspaceId,
    userWorkspaceId,
    templates,
  }: {
    workspaceId: string;
    userWorkspaceId: string;
    templates: EnsoRoleViewTemplates;
  }): Promise<EnsoViewCopies> {
    const inFlight = this.inFlightByUserWorkspaceId.get(userWorkspaceId);

    if (isDefined(inFlight)) {
      return inFlight;
    }

    const run = this.copyMissingViews({
      workspaceId,
      userWorkspaceId,
      templates,
    }).finally(() => {
      this.inFlightByUserWorkspaceId.delete(userWorkspaceId);
    });

    this.inFlightByUserWorkspaceId.set(userWorkspaceId, run);

    return run;
  }

  // Every current member of the role. Returns how many views were created.
  async ensureViewCopiesForRole({
    workspaceId,
    roleId,
  }: {
    workspaceId: string;
    roleId: string;
  }): Promise<number> {
    const templates = await this.getRoleViewTemplates({ workspaceId, roleId });
    const userWorkspaceIds =
      await this.userRoleService.getUserWorkspaceIdsAssignedToRole(
        roleId,
        workspaceId,
      );

    let createdCount = 0;

    for (const userWorkspaceId of userWorkspaceIds) {
      const before = await this.getViewCopies({ workspaceId, userWorkspaceId });
      const after = await this.ensureViewCopies({
        workspaceId,
        userWorkspaceId,
        templates,
      });

      createdCount += Object.keys(after).length - Object.keys(before).length;
    }

    return createdCount;
  }

  private async copyMissingViews({
    workspaceId,
    userWorkspaceId,
    templates,
  }: {
    workspaceId: string;
    userWorkspaceId: string;
    templates: EnsoRoleViewTemplates;
  }): Promise<EnsoViewCopies> {
    const copies = await this.getViewCopies({ workspaceId, userWorkspaceId });

    for (const templateViewIds of Object.values(templates)) {
      for (const [position, templateViewId] of templateViewIds.entries()) {
        if (isDefined(copies[templateViewId])) {
          continue;
        }

        const copyViewId = await this.copyView({
          workspaceId,
          userWorkspaceId,
          templateViewId,
          position,
        });

        if (!isDefined(copyViewId)) {
          continue;
        }

        copies[templateViewId] = copyViewId;

        await this.keyValuePairService.set({
          userId: null,
          workspaceId,
          key: ensoViewCopiesKey(userWorkspaceId),
          value: copies,
          type: KeyValuePairType.USER_VARIABLE,
        });
      }
    }

    return copies;
  }

  private async copyView({
    workspaceId,
    userWorkspaceId,
    templateViewId,
    position,
  }: {
    workspaceId: string;
    userWorkspaceId: string;
    templateViewId: string;
    position: number;
  }): Promise<string | undefined> {
    const template = await this.viewService.findByIdWithRelations(
      templateViewId,
      workspaceId,
    );

    if (!isDefined(template)) {
      this.logger.warn(`template view ${templateViewId} not found, skipped`);

      return undefined;
    }

    // Kanban columns come with the view: createOne derives them from the
    // group-by field.
    const copy = await this.viewService.createOne({
      workspaceId,
      createdByUserWorkspaceId: userWorkspaceId,
      createViewInput: {
        name: template.name,
        objectMetadataId: template.objectMetadataId,
        type: template.type,
        icon: template.icon,
        position,
        visibility: ViewVisibility.UNLISTED,
        isCompact: template.isCompact,
        openRecordIn: template.openRecordIn,
        shouldHideEmptyGroups: template.shouldHideEmptyGroups,
        kanbanAggregateOperation:
          template.kanbanAggregateOperation ?? undefined,
        kanbanAggregateOperationFieldMetadataId:
          template.kanbanAggregateOperationFieldMetadataId ?? undefined,
        mainGroupByFieldMetadataId:
          template.mainGroupByFieldMetadataId ?? undefined,
        anyFieldFilterValue: template.anyFieldFilterValue ?? undefined,
        calendarLayout: template.calendarLayout ?? undefined,
        calendarFieldMetadataId: template.calendarFieldMetadataId ?? undefined,
      },
    });

    // A copy without columns renders a blank table, so the fields matter most.
    await this.viewFieldService.createMany({
      workspaceId,
      createViewFieldInputs: (template.viewFields ?? [])
        .filter((viewField) => !isDefined(viewField.deletedAt))
        .map((viewField) => ({
          viewId: copy.id,
          fieldMetadataId: viewField.fieldMetadataId,
          isVisible: viewField.isVisible,
          size: viewField.size,
          position: viewField.position,
          aggregateOperation: viewField.aggregateOperation ?? undefined,
        })),
    });

    // Only top-level filters: the prepared views use no filter groups, and
    // copying a group tree would have to remap every parent id.
    for (const viewFilter of template.viewFilters ?? []) {
      if (
        isDefined(viewFilter.deletedAt) ||
        isDefined(viewFilter.viewFilterGroupId)
      ) {
        continue;
      }

      await this.viewFilterService.createOne({
        workspaceId,
        createViewFilterInput: {
          viewId: copy.id,
          fieldMetadataId: viewFilter.fieldMetadataId,
          operand: viewFilter.operand,
          value: viewFilter.value,
          subFieldName: viewFilter.subFieldName ?? undefined,
          relationTargetFieldMetadataId:
            viewFilter.relationTargetFieldMetadataId ?? undefined,
        },
      });
    }

    for (const viewSort of template.viewSorts ?? []) {
      if (isDefined(viewSort.deletedAt)) {
        continue;
      }

      await this.viewSortService.createOne({
        workspaceId,
        createViewSortInput: {
          viewId: copy.id,
          fieldMetadataId: viewSort.fieldMetadataId,
          direction: viewSort.direction,
          subFieldName: viewSort.subFieldName ?? undefined,
        },
      });
    }

    this.logger.log(
      `copied view "${template.name}" (${templateViewId}) for member ${userWorkspaceId} as ${copy.id}`,
    );

    return copy.id;
  }

  private async readValue({
    workspaceId,
    key,
  }: {
    workspaceId: string;
    key: string;
  }): Promise<unknown> {
    const rows = await this.keyValuePairService.get({
      type: KeyValuePairType.USER_VARIABLE,
      userId: null,
      workspaceId,
      key,
    });

    return rows?.[0]?.value;
  }
}
