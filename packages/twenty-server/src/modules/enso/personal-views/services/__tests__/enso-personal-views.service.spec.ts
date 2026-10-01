import { ViewVisibility } from 'twenty-shared/types';

import { type KeyValuePairService } from 'src/engine/core-modules/key-value-pair/key-value-pair.service';
import { type UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { type ViewFieldService } from 'src/engine/metadata-modules/view-field/services/view-field.service';
import { type ViewFilterService } from 'src/engine/metadata-modules/view-filter/services/view-filter.service';
import { type ViewSortService } from 'src/engine/metadata-modules/view-sort/services/view-sort.service';
import { type ViewService } from 'src/engine/metadata-modules/view/services/view.service';
import { EnsoPersonalViewsService } from 'src/modules/enso/personal-views/services/enso-personal-views.service';

const WORKSPACE_ID = 'workspace-id';
const MEMBER_ID = 'member-user-workspace-id';
const OBJECT_ID = 'opportunity-object-id';

const buildTemplate = (id: string) => ({
  id,
  name: `Template ${id}`,
  objectMetadataId: OBJECT_ID,
  type: 'TABLE',
  icon: 'IconList',
  isCompact: false,
  openRecordIn: 'SIDE_PANEL',
  shouldHideEmptyGroups: false,
  viewFields: [
    {
      fieldMetadataId: 'name-field',
      isVisible: true,
      size: 200,
      position: 0,
      aggregateOperation: null,
      deletedAt: null,
    },
  ],
  viewFilters: [
    {
      fieldMetadataId: 'state-field',
      operand: 'IS',
      value: ['ACTIVE'],
      viewFilterGroupId: null,
      deletedAt: null,
    },
    {
      fieldMetadataId: 'grouped-field',
      operand: 'IS',
      value: ['X'],
      viewFilterGroupId: 'some-group',
      deletedAt: null,
    },
  ],
  viewSorts: [
    { fieldMetadataId: 'created-field', direction: 'DESC', deletedAt: null },
  ],
});

describe('EnsoPersonalViewsService', () => {
  let store: Map<string, unknown>;
  let viewService: { findByIdWithRelations: jest.Mock; createOne: jest.Mock };
  let viewFieldService: { createMany: jest.Mock };
  let viewFilterService: { createOne: jest.Mock };
  let viewSortService: { createOne: jest.Mock };
  let service: EnsoPersonalViewsService;

  beforeEach(() => {
    jest.clearAllMocks();
    store = new Map();

    const keyValuePairService = {
      get: jest.fn(async ({ key }: { key: string }) =>
        store.has(key) ? [{ value: store.get(key) }] : [],
      ),
      set: jest.fn(async ({ key, value }: { key: string; value: unknown }) => {
        store.set(key, JSON.parse(JSON.stringify(value)));
      }),
    };

    let createdCount = 0;

    viewService = {
      findByIdWithRelations: jest.fn(async (id: string) =>
        id === 'missing-template' ? null : buildTemplate(id),
      ),
      createOne: jest.fn(async () => ({ id: `copy-${++createdCount}` })),
    };
    viewFieldService = { createMany: jest.fn() };
    viewFilterService = { createOne: jest.fn() };
    viewSortService = { createOne: jest.fn() };

    service = new EnsoPersonalViewsService(
      keyValuePairService as unknown as KeyValuePairService,
      {} as UserRoleService,
      viewService as unknown as ViewService,
      viewFieldService as unknown as ViewFieldService,
      viewFilterService as unknown as ViewFilterService,
      viewSortService as unknown as ViewSortService,
    );
  });

  it('should copy each template as an UNLISTED view owned by the member', async () => {
    const copies = await service.ensureViewCopies({
      workspaceId: WORKSPACE_ID,
      userWorkspaceId: MEMBER_ID,
      templates: { [OBJECT_ID]: ['template-a', 'template-b'] },
    });

    expect(copies).toEqual({ 'template-a': 'copy-1', 'template-b': 'copy-2' });
    expect(viewService.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        createdByUserWorkspaceId: MEMBER_ID,
        createViewInput: expect.objectContaining({
          visibility: ViewVisibility.UNLISTED,
          position: 1,
          name: 'Template template-b',
        }),
      }),
    );
    expect(viewFieldService.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        createViewFieldInputs: [
          expect.objectContaining({ viewId: 'copy-1', size: 200 }),
        ],
      }),
    );
    // The grouped filter is skipped; only the top-level one is copied.
    expect(viewFilterService.createOne).toHaveBeenCalledTimes(2);
    expect(viewSortService.createOne).toHaveBeenCalledTimes(2);
  });

  it('should never copy a template again once it has been copied, even if the copy was deleted', async () => {
    await service.ensureViewCopies({
      workspaceId: WORKSPACE_ID,
      userWorkspaceId: MEMBER_ID,
      templates: { [OBJECT_ID]: ['template-a'] },
    });

    const copies = await service.ensureViewCopies({
      workspaceId: WORKSPACE_ID,
      userWorkspaceId: MEMBER_ID,
      templates: { [OBJECT_ID]: ['template-a', 'template-b'] },
    });

    expect(viewService.createOne).toHaveBeenCalledTimes(2);
    expect(copies).toEqual({ 'template-a': 'copy-1', 'template-b': 'copy-2' });
  });

  it('should skip a template that no longer exists', async () => {
    const copies = await service.ensureViewCopies({
      workspaceId: WORKSPACE_ID,
      userWorkspaceId: MEMBER_ID,
      templates: { [OBJECT_ID]: ['missing-template', 'template-a'] },
    });

    expect(copies).toEqual({ 'template-a': 'copy-1' });
  });

  it('should share one run between concurrent calls for the same member', async () => {
    const templates = { [OBJECT_ID]: ['template-a'] };

    await Promise.all([
      service.ensureViewCopies({
        workspaceId: WORKSPACE_ID,
        userWorkspaceId: MEMBER_ID,
        templates,
      }),
      service.ensureViewCopies({
        workspaceId: WORKSPACE_ID,
        userWorkspaceId: MEMBER_ID,
        templates,
      }),
    ]);

    expect(viewService.createOne).toHaveBeenCalledTimes(1);
  });

  it('should report missing copies only for templates without one', () => {
    const templates = { [OBJECT_ID]: ['template-a', 'template-b'] };

    expect(
      service.hasMissingCopies({
        templates,
        copies: { 'template-a': 'copy-1' },
      }),
    ).toBe(true);
    expect(
      service.hasMissingCopies({
        templates,
        copies: { 'template-a': 'copy-1', 'template-b': 'copy-2' },
      }),
    ).toBe(false);
  });
});
