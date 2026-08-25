// Telephony intake constants. See content/docs/integrations/telephony.md for the
// design of record — in particular why the PBX (not Roistat) is the primary feed:
// Roistat only tracks a minority of the DIDs people actually dial.

// The workspace a telephony webhook belongs to. Neither Moldcell nor Roistat can
// send a workspaceId, and there is no auth context on a public webhook, so it has
// to come from config. Kept in an env var rather than baked into the webhook path
// so the id is not sitting in a third-party dashboard.
export const TELEPHONY_WORKSPACE_ID = process.env.ENSO_TELEPHONY_WORKSPACE_ID;

export const MOLDCELL_PBX_BASE_URL = process.env.ENSO_MOLDCELL_PBX_BASE_URL;
// CRM -> PBX. Used for accounts/history/makeCall.
export const MOLDCELL_PBX_TOKEN = process.env.ENSO_MOLDCELL_PBX_TOKEN;
// PBX -> CRM. The PBX echoes this back as `crm_token` on every push. The API has
// no HMAC and no signing, so this shared token is the only authenticity check.
export const MOLDCELL_CRM_TOKEN = process.env.ENSO_MOLDCELL_CRM_TOKEN;
// Roistat does not sign its callbacks at all, so the secret lives in the path.
export const ROISTAT_WEBHOOK_SECRET = process.env.ENSO_ROISTAT_WEBHOOK_SECRET;

export const MOLDCELL_CRM_API_PATH = '/sys/crm_api.wcgp';

// Prefixes keep the two providers' id spaces apart inside the single
// `sourceExternalId` column, which is our correlation + idempotency key.
export const MOLDCELL_EXTERNAL_ID_PREFIX = 'moldcell';
export const ROISTAT_EXTERNAL_ID_PREFIX = 'roistat';

// How far apart a Roistat record and a PBX call may be and still be considered
// the same call. The PBX `callid` is authoritative but Roistat never sees it, so
// the cross-provider join is (caller phone, time window). 10 minutes matches the
// legacy Upstash TTL, which was tuned against real traffic.
export const CROSS_PROVIDER_CORRELATION_WINDOW_MS = 10 * 60 * 1000;

// `event.type` values pushed by the PBX (ITooLabs).
export const MOLDCELL_EVENT_INCOMING = 'INCOMING';
export const MOLDCELL_EVENT_ACCEPTED = 'ACCEPTED';
export const MOLDCELL_EVENT_COMPLETED = 'COMPLETED';
export const MOLDCELL_EVENT_CANCELLED = 'CANCELLED';
export const MOLDCELL_EVENT_OUTGOING = 'OUTGOING';
export const MOLDCELL_EVENT_TRANSFERRED = 'TRANSFERRED';

// Moldcell `history.status` -> inboundActivity.callStatus SELECT.
// Deliberately does NOT infer "answered" from the presence of an `account`/user:
// verified against live PBX history, a group or a real user login appears in that
// column even for calls that were never picked up. Only the status/type decides.
export const MOLDCELL_STATUS_TO_CALL_STATUS: Record<string, string> = {
  Success: 'ANSWERED',
  Missed: 'UNANSWERED',
  Cancel: 'ABANDONED',
  Busy: 'BUSY',
  NotAvailable: 'CONGESTION',
  NotAllowed: 'CONGESTION',
  NotFound: 'CONGESTION',
};

// Roistat `status` -> inboundActivity.callStatus SELECT.
export const ROISTAT_STATUS_TO_CALL_STATUS: Record<string, string> = {
  ANSWER: 'ANSWERED',
  NOANSWER: 'UNANSWERED',
  BUSY: 'BUSY',
  CONGESTION: 'CONGESTION',
  CANCEL: 'ABANDONED',
  CHANUNAVAIL: 'CONGESTION',
  DONTCALL: 'ABANDONED',
  TORTURE: 'ABANDONED',
};

// PBX group logins are `g_<uuid>@<tenant>`; a real employee is `<login>@<tenant>`.
// A group in the answered-by column means "rang a department", not "a person
// answered", so it must never be treated as a sales pickup.
export const MOLDCELL_GROUP_LOGIN_PREFIX = 'g_';

// Statuses that mean a human actually spoke to the caller.
export const ANSWERED_CALL_STATUSES = ['ANSWERED', 'SALES_PICKUP'];

// The two countries we operate in.
export const MOLDOVA_DIAL_PREFIX = '373';
export const ROMANIA_DIAL_PREFIX = '40';
export const MOLDOVA_CALLING_CODE = '+373';
export const ROMANIA_CALLING_CODE = '+40';
export const MOLDOVA_COUNTRY_CODE = 'MD';
export const ROMANIA_COUNTRY_CODE = 'RO';

// Project resolution for calls Roistat does not track — which is the majority.
// Roistat states the project code itself (configured per scenario), but a call
// arriving on an untracked DID only gives us the PBX department that took it and
// the number that was dialled, so those need an operator-maintained map.
//
// An entry point carries TWO independent facts, and collapsing them loses
// information: the *project* the lead belongs to, and the *queue* that should
// handle it. TRIUMF Support and TRIUMF Sales are the same project (ENS2101 —
// AVENEW and TRIUMF are one development) but must not reach the same people,
// and a support call is not a sales lead at all.
//
// Env JSON, accepting a shorthand and a full form:
//   ENSO_TELEPHONY_PROJECT_BY_PBX_GROUP={
//     "ARTIMA": "ENS2301",
//     "TRIUMF Support": { "project": "ENS2101", "queue": "support", "lead": false },
//     "TRIUMF Sales":   { "project": "ENS2101", "queue": "sales" }
//   }
//   ENSO_TELEPHONY_PROJECT_BY_DID={"37376015220":"ENS2301"}
// A bare string means "this project, default queue, is a lead". `lead: false`
// logs the call but never creates an opportunity.
export type CallEntryPoint = {
  // project.code — matches Roistat's project_id exactly.
  project: string;
  // Which team should handle it. Distinguishes destinations inside one project.
  queue?: string;
  // Whether this entry point produces a sales lead. Defaults to true.
  lead: boolean;
};

const parseEntryPoint = (value: unknown): CallEntryPoint | undefined => {
  if (typeof value === 'string') {
    return value ? { project: value, lead: true } : undefined;
  }

  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const project = record.project;

  if (typeof project !== 'string' || !project) {
    return undefined;
  }

  return {
    project,
    ...(typeof record.queue === 'string' && record.queue
      ? { queue: record.queue }
      : {}),
    lead: record.lead !== false,
  };
};

const parseEntryPointMap = (
  raw: string | undefined,
  label: string,
): Record<string, CallEntryPoint> => {
  if (!raw) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }

    const entries = Object.entries(parsed as Record<string, unknown>)
      .map(([key, value]) => [key, parseEntryPoint(value)] as const)
      .filter(
        (entry): entry is [string, CallEntryPoint] => entry[1] !== undefined,
      );

    return Object.fromEntries(entries);
  } catch {
    // A malformed map must not take the whole intake path down; calls still land
    // as activities, they just arrive without a project.
    // eslint-disable-next-line no-console
    console.warn(`Ignoring malformed ${label}`);

    return {};
  }
};

export const ENTRY_POINT_BY_PBX_GROUP = parseEntryPointMap(
  process.env.ENSO_TELEPHONY_PROJECT_BY_PBX_GROUP,
  'ENSO_TELEPHONY_PROJECT_BY_PBX_GROUP',
);

export const ENTRY_POINT_BY_DID = parseEntryPointMap(
  process.env.ENSO_TELEPHONY_PROJECT_BY_DID,
  'ENSO_TELEPHONY_PROJECT_BY_DID',
);

// Roistat scenarios need the same treatment: two scenarios can share a project
// but belong to different teams. Keyed on the Roistat scenario/marker name.
export const ENTRY_POINT_BY_ROISTAT_SCENARIO = parseEntryPointMap(
  process.env.ENSO_TELEPHONY_PROJECT_BY_ROISTAT_SCENARIO,
  'ENSO_TELEPHONY_PROJECT_BY_ROISTAT_SCENARIO',
);
