import { randomBytes } from 'crypto';

import { type WhereExpressionBuilder } from 'typeorm';

import { isUserAuthContext } from 'src/engine/core-modules/auth/guards/is-user-auth-context.guard';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceInternalContext } from 'src/engine/twenty-orm/interfaces/workspace-internal-context.interface';
import { computeTableName } from 'src/engine/utils/compute-table-name.util';
import { getWorkspaceSchemaName } from 'src/engine/workspace-datasource/utils/get-workspace-schema-name.util';
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
  // Updates and deletes emit no alias, so the target table is addressed by name.
  useDirectTableReference?: boolean;
};

export const applyEnsoRecordVisibility = ({
  queryBuilder,
  objectMetadata,
  internalContext,
  authContext,
  useDirectTableReference = false,
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
    ? computeTableName(objectMetadata.nameSingular, objectMetadata.isCustom)
    : queryBuilder.expressionMap.mainAlias?.name;

  if (!recordReference) {
    return;
  }

  const paramName = `ensoVisibilityMemberId_${randomBytes(5).toString('hex')}`;
  const workspaceMemberId = authContext.workspaceMember?.id;

  // A scoped role with no workspace member owns nothing, so it sees nothing.
  // Failing closed matters more here than a friendlier empty state.
  const condition = workspaceMemberId
    ? rule.buildCondition({
        ref: (columnName) => `"${recordReference}"."${columnName}"`,
        schema: `"${getWorkspaceSchemaName(internalContext.workspaceId)}"`,
        me: `:${paramName}`,
      })
    : 'FALSE';

  const parameters = workspaceMemberId
    ? { [paramName]: workspaceMemberId }
    : {};

  if (queryBuilder.expressionMap.wheres.length === 0) {
    queryBuilder.where(condition, parameters);
  } else {
    queryBuilder.andWhere(condition, parameters);
  }
};
