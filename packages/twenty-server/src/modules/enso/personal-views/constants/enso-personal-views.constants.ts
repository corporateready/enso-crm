// Personal view copies are configured and tracked in core.keyValuePair, like
// the rest of the enso view settings (see enso-default-views.constants.ts).

// Workspace-scoped, one row per role: objectMetadataId → the ordered template
// view ids every member of that role gets a personal copy of.
export const ENSO_ROLE_VIEW_TEMPLATES_KEY_PREFIX = 'ENSO_ROLE_VIEW_TEMPLATES:';

export const ensoRoleViewTemplatesKey = (roleId: string): string =>
  `${ENSO_ROLE_VIEW_TEMPLATES_KEY_PREFIX}${roleId}`;

// Workspace-scoped, one row per member: templateViewId → the copy made for
// them. Keyed on the userWorkspaceId because that is what owns an UNLISTED
// view. A template that is in this map is never copied again, so a copy the
// member deletes stays deleted.
export const ENSO_VIEW_COPIES_KEY_PREFIX = 'ENSO_VIEW_COPIES:';

export const ensoViewCopiesKey = (userWorkspaceId: string): string =>
  `${ENSO_VIEW_COPIES_KEY_PREFIX}${userWorkspaceId}`;
