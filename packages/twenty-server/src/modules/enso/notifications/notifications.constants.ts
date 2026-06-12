// Per-manager Google Chat notification settings.
// The webhook URL is a personal secret (it grants posting into that manager's
// private space), so it is stored encrypted in the core keyValuePair table as a
// USER_VARIABLE scoped to (userId, workspaceId) — never on a workspace object.
export const GOOGLE_CHAT_WEBHOOK_URL_KEY = 'GOOGLE_CHAT_WEBHOOK_URL';

// Shown in the settings UI instead of the real URL once configured.
export const GOOGLE_CHAT_WEBHOOK_URL_MASK = '••••••••••';

// Incoming webhooks only ever live on this host; reject anything else so a
// stored URL can't be pointed at an internal/arbitrary endpoint.
export const GOOGLE_CHAT_WEBHOOK_HOST = 'chat.googleapis.com';
