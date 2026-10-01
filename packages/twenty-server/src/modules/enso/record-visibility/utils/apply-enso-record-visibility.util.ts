import { randomBytes } from 'crypto';

import { isDefined } from 'twenty-shared/utils';
import { type WhereExpressionBuilder } from 'typeorm';

import { isUserAuthContext } from 'src/engine/core-modules/auth/guards/is-user-auth-context.guard';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceInternalContext } from 'src/engine/twenty-orm/interfaces/workspace-internal-context.interface';
import { computeTableName } from 'src/engine/utils/compute-table-name.util';
import { getWorkspaceSchemaName } from 'src/engine/workspace-datasource/utils/get-workspace-schema-name.util';
import { DEAL_COMMENT_MENTION_OBJECT } from 'src/modules/enso/deal-comment/deal-comment.constants';
import { ENSO_RECORD_VISIBILITY_RULES } from 'src/modules/enso/record-visibility/constants/enso-record-visibility-rules.constant';
import { getEnsoScopedRoleIds } from 'src/modules/enso/record-visibility/utils/get-enso-scoped-role-ids.util';

type EnsoVisibilityQueryBuilder = WhereExpressionBuilder & {
  expressionMap: {
    wheres: unknown[];
    mainAlias?: { name: string } | undefined;
  };
};

type ApplyEnsoRecordVisibilityArgs = {
  queryBuilder: EnsoVisibilityQueryBuilder;
  objectMetadata: FlatObjectMetadata;
  internalContext: WorkspaceInternalContext;
  authContext: WorkspaceAuthContext;
  // Set by the update, soft-delete and delete builders. Their statements emit
  // no alias, but the same WHERE clauses are also copied into the "before" and
  // "after" event SELECT, which does alias the table.
  useDirectTableReference?: boolean;
  // Writes get the narrower rule: a deal you were only mentioned on is
  // readable, not editable or deletable.
  access?: 'read' | 'write';
};

// Alias for the visibility subquery's own copy of the table. Must not collide
// with the aliases the rules use internally (ppa, opp, cpa).
const VISIBLE_ROW_ALIAS = 'ensoVisibleRow';

export const applyEnsoRecordVisibility = ({
  queryBuilder,
  objectMetadata,
  internalContext,
  authContext,
  useDirectTableReference = false,
  access = 'read',
}: ApplyEnsoRecordVisibilityArgs): void => {
  const scopedRoleIds = getEnsoScopedRoleIds();

  if (scopedRoleIds.size === 0 || !isUserAuthContext(authContext)) {
    return;
  }

  const roleId =
    internalContext.userWorkspaceRoleMap[authContext.userWorkspaceId];

  if (!roleId || !scopedRoleIds.has(roleId)) {
    return;
  }

  const rule = ENSO_RECORD_VISIBILITY_RULES[objectMetadata.nameSingular];

  if (!rule) {
    return;
  }

  // The rules correlate subqueries back to the row being filtered, so every
  // outer column has to stay qualified or Postgres resolves it against the
  // innermost subquery instead.
  const recordReference = useDirectTableReference
    ? VISIBLE_ROW_ALIAS
    : queryBuilder.expressionMap.mainAlias?.name;

  if (!recordReference) {
    return;
  }

  const paramName = `ensoVisibilityMemberId_${randomBytes(5).toString('hex')}`;
  const workspaceMemberId = authContext.workspaceMember?.id;
  const schema = `"${getWorkspaceSchemaName(internalContext.workspaceId)}"`;

  // A scoped role with no workspace member owns nothing, so it sees nothing.
  // Failing closed matters more here than a friendlier empty state.
  const ruleCondition = workspaceMemberId
    ? rule.buildCondition({
        ref: (columnName) => `"${recordReference}"."${columnName}"`,
        schema,
        me: `:${paramName}`,
        includeMentionedDeals:
          access === 'read' &&
          isDefined(
            internalContext.objectIdByNameSingular?.[
              DEAL_COMMENT_MENTION_OBJECT
            ],
          ),
      })
    : 'FALSE';

  // A mutation's table can be addressed by its bare name (the UPDATE itself)
  // or by whatever alias TypeORM gave the builder (the event SELECT): "task"
  // for the record a user deletes, but "workspace_x.taskTarget" for the rows a
  // delete cascades to. Naming the table directly broke every cascade from a
  // scoped role ("missing FROM-clause entry"). Filtering by id through a
  // subquery with its own alias works under either name. The bare outer "id"
  // is safe because these statements never join another table.
  const condition = useDirectTableReference
    ? `"id" IN (SELECT "${VISIBLE_ROW_ALIAS}"."id" FROM ${schema}."${computeTableName(
        objectMetadata.nameSingular,
        objectMetadata.isCustom,
      )}" "${VISIBLE_ROW_ALIAS}" WHERE ${ruleCondition})`
    : ruleCondition;

  const parameters = workspaceMemberId
    ? { [paramName]: workspaceMemberId }
    : {};

  if (queryBuilder.expressionMap.wheres.length === 0) {
    queryBuilder.where(condition, parameters);
  } else {
    queryBuilder.andWhere(condition, parameters);
  }
};
