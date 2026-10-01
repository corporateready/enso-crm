import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceInternalContext } from 'src/engine/twenty-orm/interfaces/workspace-internal-context.interface';
import { applyEnsoRecordVisibility } from 'src/modules/enso/record-visibility/utils/apply-enso-record-visibility.util';
import { resetEnsoScopedRoleIdsCache } from 'src/modules/enso/record-visibility/utils/get-enso-scoped-role-ids.util';

const SCOPED_ROLE_ID = 'scoped-role-id';
const USER_WORKSPACE_ID = 'user-workspace-id';
const WORKSPACE_ID = '20202020-1c25-4d02-bf25-6aeccf7ea419';

const internalContext = {
  workspaceId: WORKSPACE_ID,
  userWorkspaceRoleMap: { [USER_WORKSPACE_ID]: SCOPED_ROLE_ID },
} as unknown as WorkspaceInternalContext;

const authContext = {
  type: 'user',
  userWorkspaceId: USER_WORKSPACE_ID,
  workspaceMember: { id: 'member-id' },
} as unknown as WorkspaceAuthContext;

const taskTargetMetadata = {
  nameSingular: 'taskTarget',
  isCustom: false,
} as FlatObjectMetadata;

const buildQueryBuilder = (mainAliasName?: string) => {
  const where = jest.fn();
  const andWhere = jest.fn();

  return {
    queryBuilder: {
      where,
      andWhere,
      expressionMap: {
        wheres: [],
        mainAlias: mainAliasName ? { name: mainAliasName } : undefined,
      },
    } as unknown as Parameters<
      typeof applyEnsoRecordVisibility
    >[0]['queryBuilder'],
    where,
  };
};

describe('applyEnsoRecordVisibility', () => {
  const originalScopedRoleIds = process.env.ENSO_SCOPED_VISIBILITY_ROLE_IDS;

  beforeEach(() => {
    process.env.ENSO_SCOPED_VISIBILITY_ROLE_IDS = SCOPED_ROLE_ID;
    resetEnsoScopedRoleIdsCache();
  });

  afterAll(() => {
    process.env.ENSO_SCOPED_VISIBILITY_ROLE_IDS = originalScopedRoleIds;
    resetEnsoScopedRoleIdsCache();
  });

  it('should qualify the rule with the select alias on a plain read', () => {
    const { queryBuilder, where } = buildQueryBuilder('taskTarget');

    applyEnsoRecordVisibility({
      queryBuilder,
      objectMetadata: taskTargetMetadata,
      internalContext,
      authContext,
    });

    const [condition] = where.mock.calls[0];

    expect(condition).toContain('"taskTarget"."targetPersonId"');
  });

  // The same WHERE clauses run in the UPDATE (table addressed by bare name)
  // and in the event SELECT (table aliased by TypeORM, e.g.
  // "workspace_x.taskTarget" on a cascade). A delete of a task by a Sales
  // Manager failed with "missing FROM-clause entry for table taskTarget"
  // until the condition stopped naming the outer table at all.
  it('should not reference the outer table by name on a mutation', () => {
    const { queryBuilder, where } = buildQueryBuilder('workspace_x.taskTarget');

    applyEnsoRecordVisibility({
      queryBuilder,
      objectMetadata: taskTargetMetadata,
      internalContext,
      authContext,
      useDirectTableReference: true,
    });

    const [condition] = where.mock.calls[0];

    expect(condition).toMatch(
      /^"id" IN \(SELECT "ensoVisibleRow"\."id" FROM "workspace_[a-z0-9]+"\."taskTarget" "ensoVisibleRow" WHERE /,
    );
    expect(condition).not.toContain('"taskTarget"."');
    expect(condition).toContain('"ensoVisibleRow"."targetPersonId"');
  });

  it('should use the underscored table name for a custom object mutation', () => {
    const { queryBuilder, where } = buildQueryBuilder();

    applyEnsoRecordVisibility({
      queryBuilder,
      objectMetadata: {
        nameSingular: 'personProjectAssignment',
        isCustom: true,
      } as FlatObjectMetadata,
      internalContext,
      authContext,
      useDirectTableReference: true,
    });

    const [condition] = where.mock.calls[0];

    expect(condition).toContain('."_personProjectAssignment" "ensoVisibleRow"');
  });

  it('should match nothing on a mutation when the member is unknown', () => {
    const { queryBuilder, where } = buildQueryBuilder();

    applyEnsoRecordVisibility({
      queryBuilder,
      objectMetadata: taskTargetMetadata,
      internalContext,
      authContext: {
        ...authContext,
        workspaceMember: undefined,
      } as unknown as WorkspaceAuthContext,
      useDirectTableReference: true,
    });

    const [condition] = where.mock.calls[0];

    expect(condition).toMatch(/WHERE FALSE\)$/);
  });

  it('should leave queries from unscoped roles untouched', () => {
    const { queryBuilder, where } = buildQueryBuilder('taskTarget');

    applyEnsoRecordVisibility({
      queryBuilder,
      objectMetadata: taskTargetMetadata,
      internalContext: {
        ...internalContext,
        userWorkspaceRoleMap: { [USER_WORKSPACE_ID]: 'admin-role-id' },
      } as unknown as WorkspaceInternalContext,
      authContext,
      useDirectTableReference: true,
    });

    expect(where).not.toHaveBeenCalled();
  });
});
