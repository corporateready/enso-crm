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

// Per-manager, per-event on/off toggles, stored as a JSON map in keyValuePair
// (USER_VARIABLE, per userId+workspaceId). A missing key means ON — events are
// opt-OUT, so a manager receives everything until they mute something.
export const NOTIFICATION_PREFERENCES_KEY = 'NOTIFICATION_PREFERENCES';

// Event keys for the toggles. String literals (not an enum) so they flow through
// GraphQL and the keyValuePair JSON untouched. Keep in sync with the front list.
export const NOTIFICATION_EVENTS = {
  LEAD_ASSIGNED: 'leadAssigned',
  LEAD_LOST: 'leadLost',
  DEAL_STATE_CHANGED: 'dealStateChanged',
  INBOUND_REENGAGED: 'inboundReengaged',
  TASK_ASSIGNED: 'taskAssigned',
  TASK_DUE: 'taskDue',
  CONSENT_CHANGED: 'consentChanged',
} as const;

// Task-due scanner (Phase 2b): a per-minute cron sweeps tasks that have just
// crossed their dueAt and notifies the assignee. A per-workspace watermark
// (keyValuePair) makes it notify each task exactly once, resilient to missed
// ticks; first run seeds the watermark to "now" so it never floods on deploy.
export const TASK_DUE_SCANNER_CRON_PATTERN = '* * * * *';
export const TASK_DUE_LAST_SCAN_KEY = 'TASK_DUE_LAST_SCAN_AT';

// SMS delivery-receipt poll: sms.md has no push DLR, so refresh the status of
// recently-sent SMS every 2 minutes (low volume, manual sends).
export const SMS_DELIVERY_SCANNER_CRON_PATTERN = '*/2 * * * *';

export type NotificationEventKey =
  (typeof NOTIFICATION_EVENTS)[keyof typeof NOTIFICATION_EVENTS];

export const NOTIFICATION_EVENT_KEYS: NotificationEventKey[] =
  Object.values(NOTIFICATION_EVENTS);

// ── Second lane: per-PROJECT marketing spaces ────────────────────────────────
//
// Distinct from the per-manager lane above, and deliberately so. The manager
// lane is private and time-critical ("claim this in 3 minutes"); this one is a
// shared per-development room the MARKETING team reads to see what their spend
// is producing — ARTIMA Leads, AVRAM IANCU Leads, TRIUMF BOTANICA Leads,
// Vânzări Imobiliare Leads. The same new deal therefore produces two posts:
// one to the owner privately, one to the project room. That is the design, not
// duplication.
//
// Stored per project, workspace-scoped (userId = null) and encrypted, because a
// webhook URL is a capability: whoever holds it can post into that space.
export const PROJECT_CHAT_WEBHOOK_URL_KEY_PREFIX = 'PROJECT_CHAT_WEBHOOK_URL:';

export const projectChatWebhookKey = (projectId: string): string =>
  `${PROJECT_CHAT_WEBHOOK_URL_KEY_PREFIX}${projectId}`;
