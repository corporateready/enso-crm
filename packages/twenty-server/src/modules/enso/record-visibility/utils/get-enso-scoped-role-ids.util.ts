// Roles whose members only see the records they own. Read straight from the
// environment rather than through TwentyConfigService: this runs inside the
// TypeORM query builders, which are constructed by hand and have no DI access.
// Clearing the variable is the kill switch — it restores full visibility on the
// next boot without a code change.
let cachedScopedRoleIds: Set<string> | null = null;

export const getEnsoScopedRoleIds = (): Set<string> => {
  if (cachedScopedRoleIds === null) {
    cachedScopedRoleIds = new Set(
      (process.env.ENSO_SCOPED_VISIBILITY_ROLE_IDS ?? '')
        .split(',')
        .map((roleId) => roleId.trim())
        .filter((roleId) => roleId.length > 0),
    );
  }

  return cachedScopedRoleIds;
};

export const resetEnsoScopedRoleIdsCache = (): void => {
  cachedScopedRoleIds = null;
};
