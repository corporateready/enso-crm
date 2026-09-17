// VIEWS is deliberately NOT here. Everything in this list is granted wholesale
// by a role's canAccessAllTools, which every default Member role and every role
// the Roles UI creates starts with switched on — so listing VIEWS handed
// "create, edit and delete workspace views" to every member by default. Managing
// shared views is workspace structure, like LAYOUTS or DATA_MODEL, so it hangs
// off canUpdateAllSettings or an explicit permission flag instead.
export const TOOL_PERMISSION_FLAGS = [
  'AI',
  'UPLOAD_FILE',
  'DOWNLOAD_FILE',
  'SEND_EMAIL_TOOL',
  'HTTP_REQUEST_TOOL',
  'IMPORT_CSV',
  'EXPORT_CSV',
  'CONNECTED_ACCOUNTS',
  'PROFILE_INFORMATION',
  'CODE_INTERPRETER_TOOL',
];
