import { resetEnsoScopedRoleIdsCache } from 'src/modules/enso/record-visibility/utils/get-enso-scoped-role-ids.util';
import { selectEnsoVisibleRecordIds } from 'src/modules/enso/record-visibility/utils/select-enso-visible-record-ids.util';

const workspaceId = '20202020-1c25-4d02-bf25-6aeccf7ea419';
const scopedRoleId = 'sales-manager-role-id';
const memberId = 'member-1';

describe('selectEnsoVisibleRecordIds', () => {
  const originalScopedRoleIds = process.env.ENSO_SCOPED_VISIBILITY_ROLE_IDS;

  beforeEach(() => {
    process.env.ENSO_SCOPED_VISIBILITY_ROLE_IDS = scopedRoleId;
    resetEnsoScopedRoleIdsCache();
  });

  afterAll(() => {
    process.env.ENSO_SCOPED_VISIBILITY_ROLE_IDS = originalScopedRoleIds;
    resetEnsoScopedRoleIdsCache();
  });

  it('should return null without querying when the role is not scoped', async () => {
    const runQuery = jest.fn();

    const result = await selectEnsoVisibleRecordIds({
      workspaceId,
      objectMetadata: { nameSingular: 'opportunity', isCustom: false },
      roleId: 'admin-role-id',
      workspaceMemberId: memberId,
      recordIds: ['opp-1'],
      runQuery,
    });

    expect(result).toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('should return null without querying when the object has no rule', async () => {
    const runQuery = jest.fn();

    const result = await selectEnsoVisibleRecordIds({
      workspaceId,
      objectMetadata: { nameSingular: 'company', isCustom: false },
      roleId: scopedRoleId,
      workspaceMemberId: memberId,
      recordIds: ['company-1'],
      runQuery,
    });

    expect(result).toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('should see nothing when a scoped subscriber has no workspace member', async () => {
    const runQuery = jest.fn();

    const result = await selectEnsoVisibleRecordIds({
      workspaceId,
      objectMetadata: { nameSingular: 'opportunity', isCustom: false },
      roleId: scopedRoleId,
      workspaceMemberId: undefined,
      recordIds: ['opp-1'],
      runQuery,
    });

    expect(result).toEqual(new Set());
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('should re-select the records through the rule as the subscriber', async () => {
    const runQuery = jest.fn().mockResolvedValue([{ id: 'opp-1' }]);

    const result = await selectEnsoVisibleRecordIds({
      workspaceId,
      objectMetadata: { nameSingular: 'opportunity', isCustom: false },
      roleId: scopedRoleId,
      workspaceMemberId: memberId,
      recordIds: ['opp-1', 'opp-2'],
      runQuery,
    });

    expect(result).toEqual(new Set(['opp-1']));

    const [sql, parameters] =
      runQuery.mock.calls[runQuery.mock.calls.length - 1];

    expect(sql).toContain('."opportunity" rec');
    expect(sql).toContain('rec."ownerId" = $2');
    expect(sql).toContain('rec."id" = ANY($1::uuid[])');
    expect(sql).not.toContain('rec."deletedAt"');
    expect(parameters).toEqual([['opp-1', 'opp-2'], memberId]);
  });

  it('should address custom objects by their prefixed table name', async () => {
    const runQuery = jest.fn().mockResolvedValue([]);

    await selectEnsoVisibleRecordIds({
      workspaceId,
      objectMetadata: {
        nameSingular: 'personProjectAssignment',
        isCustom: true,
      },
      roleId: scopedRoleId,
      workspaceMemberId: memberId,
      recordIds: ['ppa-1'],
      runQuery,
    });

    expect(runQuery.mock.calls[runQuery.mock.calls.length - 1][0]).toContain(
      '."_personProjectAssignment" rec',
    );
  });

  it('should let a mentioned subscriber see the deal once the mention table exists', async () => {
    const runQuery = jest
      .fn()
      .mockResolvedValueOnce([{ id: true }])
      .mockResolvedValue([{ id: 'opp-1' }]);

    await selectEnsoVisibleRecordIds({
      workspaceId: '20202020-0000-4000-8000-0000000000a1',
      objectMetadata: { nameSingular: 'opportunity', isCustom: false },
      roleId: scopedRoleId,
      workspaceMemberId: memberId,
      recordIds: ['opp-1'],
      runQuery,
    });

    expect(runQuery.mock.calls[0][0]).toContain('to_regclass');
    expect(runQuery.mock.calls[runQuery.mock.calls.length - 1][0]).toContain(
      '"_dealCommentMention"',
    );
  });

  it('should leave the mention table out while it does not exist yet', async () => {
    const runQuery = jest
      .fn()
      .mockResolvedValueOnce([{ id: false }])
      .mockResolvedValue([]);

    await selectEnsoVisibleRecordIds({
      workspaceId: '20202020-0000-4000-8000-0000000000a2',
      objectMetadata: { nameSingular: 'opportunity', isCustom: false },
      roleId: scopedRoleId,
      workspaceMemberId: memberId,
      recordIds: ['opp-1'],
      runQuery,
    });

    expect(
      runQuery.mock.calls[runQuery.mock.calls.length - 1][0],
    ).not.toContain('_dealCommentMention');
  });
});
