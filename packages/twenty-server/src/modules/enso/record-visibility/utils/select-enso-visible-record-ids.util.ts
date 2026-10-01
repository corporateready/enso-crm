import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { computeTableName } from 'src/engine/utils/compute-table-name.util';
import { getWorkspaceSchemaName } from 'src/engine/workspace-datasource/utils/get-workspace-schema-name.util';
import { DEAL_COMMENT_MENTION_OBJECT } from 'src/modules/enso/deal-comment/deal-comment.constants';
import { ENSO_RECORD_VISIBILITY_RULES } from 'src/modules/enso/record-visibility/constants/enso-record-visibility-rules.constant';
import { getEnsoScopedRoleIds } from 'src/modules/enso/record-visibility/utils/get-enso-scoped-role-ids.util';

type SelectEnsoVisibleRecordIdsArgs = {
  workspaceId: string;
  objectMetadata: Pick<FlatObjectMetadata, 'nameSingular' | 'isCustom'>;
  roleId: string;
  workspaceMemberId: string | undefined;
  recordIds: string[];
  runQuery: (sql: string, parameters: unknown[]) => Promise<{ id: string }[]>;
};

// Workspaces whose mention table is known to exist. Once provisioned it stays,
// so a positive answer is remembered and the check costs one query per
// workspace per process; a negative answer is re-asked, so provisioning takes
// effect without a restart.
const workspacesWithMentionTable = new Set<string>();

const hasMentionTable = async (
  workspaceId: string,
  schema: string,
  runQuery: SelectEnsoVisibleRecordIdsArgs['runQuery'],
): Promise<boolean> => {
  if (workspacesWithMentionTable.has(workspaceId)) {
    return true;
  }

  const tableName = computeTableName(DEAL_COMMENT_MENTION_OBJECT, true);
  const rows = (await runQuery(`SELECT to_regclass($1) IS NOT NULL AS "id"`, [
    `${schema}."${tableName}"`,
  ])) as unknown as { id: boolean }[];

  if (rows[0]?.id === true) {
    workspacesWithMentionTable.add(workspaceId);

    return true;
  }

  return false;
};

// Live updates match events against a subscriber's filters in memory, so they
// never pass through the query builders that apply the scoping rules. This
// re-selects the event's records with the same rules, as the subscriber.
//
// Returns null when the subscriber is not scoped for this object (deliver
// everything). The main row is not filtered on deletedAt, so soft-delete and
// restore events still reach the owner; a destroyed row is gone and drops out,
// which is the safe direction.
export const selectEnsoVisibleRecordIds = async ({
  workspaceId,
  objectMetadata,
  roleId,
  workspaceMemberId,
  recordIds,
  runQuery,
}: SelectEnsoVisibleRecordIdsArgs): Promise<Set<string> | null> => {
  if (!getEnsoScopedRoleIds().has(roleId)) {
    return null;
  }

  const rule = ENSO_RECORD_VISIBILITY_RULES[objectMetadata.nameSingular];

  if (!rule) {
    return null;
  }

  // Same fail-closed stance as the query builders: no member, owns nothing.
  if (!workspaceMemberId || recordIds.length === 0) {
    return new Set();
  }

  const schema = `"${getWorkspaceSchemaName(workspaceId)}"`;
  const tableName = computeTableName(
    objectMetadata.nameSingular,
    objectMetadata.isCustom,
  );

  // A live update is a read, so a deal the subscriber was mentioned on counts.
  const condition = rule.buildCondition({
    ref: (columnName) => `rec."${columnName}"`,
    schema,
    me: '$2',
    includeMentionedDeals: await hasMentionTable(workspaceId, schema, runQuery),
  });

  const rows = await runQuery(
    `SELECT rec."id" FROM ${schema}."${tableName}" rec
     WHERE rec."id" = ANY($1::uuid[]) AND ${condition}`,
    [recordIds, workspaceMemberId],
  );

  return new Set(rows.map((row) => row.id));
};
