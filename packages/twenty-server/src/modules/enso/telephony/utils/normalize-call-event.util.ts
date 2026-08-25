import {
  MOLDCELL_EVENT_ACCEPTED,
  MOLDCELL_EVENT_CANCELLED,
  MOLDCELL_EVENT_COMPLETED,
  MOLDCELL_EVENT_INCOMING,
  MOLDCELL_EXTERNAL_ID_PREFIX,
  MOLDCELL_GROUP_LOGIN_PREFIX,
  MOLDCELL_STATUS_TO_CALL_STATUS,
  ROISTAT_EXTERNAL_ID_PREFIX,
  ROISTAT_STATUS_TO_CALL_STATUS,
} from 'src/modules/enso/telephony/telephony.constants';
import {
  type MoldcellEventPush,
  type MoldcellHistoryPush,
  type NormalizedCallEvent,
  type RoistatCallWebhook,
} from 'src/modules/enso/telephony/types/telephony.types';

// Country dial prefixes we operate in. Used to promote a national-format number
// to E.164 using the dialled DID as the country hint.
const MOLDOVA_PREFIX = '373';
const ROMANIA_PREFIX = '40';

// Shortest plausible international subscriber number. Anything below this is an
// internal extension or junk; we return undefined rather than minting a bogus
// contact from it.
const MIN_INTERNATIONAL_DIGITS = 9;

const digitsOnly = (value: unknown): string =>
  String(value ?? '').replace(/\D/g, '');

// The legacy stack had eight different phone helpers, none of which validated or
// promoted national numbers — a local `0XXXXXXX` stayed `0XXXXXXX`, failed both
// `startsWith('373')` and `startsWith('40')`, and fell through to the weakest
// code path with no brand routing. This is the single replacement.
//
// `countryHint` should be the dialled DID: a Moldovan caller reaching a Moldovan
// DID in national format is a +373 number, and that is the only reliable signal
// available at intake.
export const normalizeE164 = (
  raw: unknown,
  countryHint?: unknown,
): string | undefined => {
  let digits = digitsOnly(raw);

  if (!digits) {
    return undefined;
  }

  // "00373..." — international access code.
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  // Already international.
  if (digits.startsWith(MOLDOVA_PREFIX) || digits.startsWith(ROMANIA_PREFIX)) {
    return digits.length >= MIN_INTERNATIONAL_DIGITS ? `+${digits}` : undefined;
  }

  // National format: drop the trunk zero and prepend the country of the DID.
  if (digits.startsWith('0')) {
    const national = digits.replace(/^0+/, '');
    const hint = digitsOnly(countryHint);
    const country = hint.startsWith(ROMANIA_PREFIX)
      ? ROMANIA_PREFIX
      : hint.startsWith(MOLDOVA_PREFIX)
        ? MOLDOVA_PREFIX
        : undefined;

    if (!country || !national) {
      return undefined;
    }

    return `+${country}${national}`;
  }

  return digits.length >= MIN_INTERNATIONAL_DIGITS ? `+${digits}` : undefined;
};

// PBX logins arrive as `<login>@<tenant>`; groups as `g_<uuid>@<tenant>`.
export const splitPbxLogin = (
  value: unknown,
): { login?: string; isGroup: boolean } => {
  const local = String(value ?? '')
    .split('@')[0]
    .trim();

  if (!local) {
    return { isGroup: false };
  }

  return {
    login: local,
    isGroup: local.startsWith(MOLDCELL_GROUP_LOGIN_PREFIX),
  };
};

// Push format is the compact basic ISO `YYYYmmddTHHMMSSZ`. (Confusingly, the
// cmd=history *response* uses extended ISO8601 — handle both.)
export const parseMoldcellTimestamp = (value: unknown): Date | undefined => {
  const raw = String(value ?? '').trim();

  if (!raw) {
    return undefined;
  }

  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);

  const iso = compact
    ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z`
    : raw;

  const parsed = new Date(iso);

  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

// Roistat sends "YYYY-MM-DD HH:mm:ss" with no zone marker; it is UTC.
export const parseRoistatTimestamp = (value: unknown): Date | undefined => {
  const raw = String(value ?? '').trim();

  if (!raw) {
    return undefined;
  }

  const normalized = raw.includes('T')
    ? raw
    : `${raw.replace(' ', 'T')}${raw.endsWith('Z') ? '' : 'Z'}`;

  const parsed = new Date(normalized);

  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const toDurationSeconds = (value: unknown): number | undefined => {
  const parsed = Number.parseInt(String(value ?? ''), 10);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

export const normalizeMoldcellEvent = (
  push: MoldcellEventPush,
): NormalizedCallEvent | undefined => {
  const callId = String(push.callid ?? '').trim();

  if (!callId) {
    return undefined;
  }

  const type = String(push.type ?? '').toUpperCase();
  const { login, isGroup } = splitPbxLogin(push.user);

  // CANCELLED means the caller hung up before anyone picked up. COMPLETED means
  // the conversation ended normally. Both are terminal; ACCEPTED is not (the
  // call is still in progress) but it does tell us who took it.
  const isTerminal =
    type === MOLDCELL_EVENT_COMPLETED || type === MOLDCELL_EVENT_CANCELLED;

  return {
    externalId: `${MOLDCELL_EXTERNAL_ID_PREFIX}:${callId}`,
    provider: 'moldcell',
    eventKey: `moldcell:event:${type || 'UNKNOWN'}`,
    // `event` never carries duration/recording, and `history` is the real
    // outcome record, so an event must not clobber what history established.
    isAuthoritativeOutcome: false,
    callerE164: normalizeE164(push.phone, push.diversion),
    calleeDid: digitsOnly(push.diversion) || undefined,
    // The push carries no timestamp. Only INCOMING approximates the call START
    // (it fires while the phone rings); COMPLETED/CANCELLED fire at the END, so
    // stamping them with "now" would move occurredAt to the wrong end of the
    // call and corrupt the correlation window.
    occurredAt: type === MOLDCELL_EVENT_INCOMING ? new Date() : undefined,
    callStatus: type === MOLDCELL_EVENT_CANCELLED ? 'ABANDONED' : undefined,
    answeredByLogin:
      type === MOLDCELL_EVENT_ACCEPTED && !isGroup ? login : undefined,
    answeredByGroup: isGroup
      ? (push.groupRealName ?? login)
      : (push.groupRealName ?? undefined),
    rawPayload: push,
    isTerminal,
  };
};

export const normalizeMoldcellHistory = (
  push: MoldcellHistoryPush,
): NormalizedCallEvent | undefined => {
  const callId = String(push.callid ?? '').trim();

  if (!callId) {
    return undefined;
  }

  const { login, isGroup } = splitPbxLogin(push.user);
  const status = String(push.status ?? '').trim();

  return {
    externalId: `${MOLDCELL_EXTERNAL_ID_PREFIX}:${callId}`,
    provider: 'moldcell',
    eventKey: 'moldcell:history',
    isAuthoritativeOutcome: true,
    callerE164: normalizeE164(push.phone, push.diversion),
    calleeDid: digitsOnly(push.diversion) || undefined,
    occurredAt: parseMoldcellTimestamp(push.start),
    callStatus: MOLDCELL_STATUS_TO_CALL_STATUS[status],
    durationS: toDurationSeconds(push.duration),
    recordingUrl: String(push.link ?? '').trim() || undefined,
    answeredByLogin: isGroup ? undefined : login,
    answeredByGroup: isGroup
      ? (push.groupRealName ?? login)
      : (push.groupRealName ?? undefined),
    rawPayload: push,
    // history only fires once the call is over.
    isTerminal: true,
  };
};

export const normalizeRoistatCall = (
  push: RoistatCallWebhook,
): NormalizedCallEvent | undefined => {
  const callId = String(push.id ?? '').trim();

  if (!callId) {
    return undefined;
  }

  const custom = push.custom_fields ?? {};
  const status = String(push.status ?? '').toUpperCase();

  // Only the after-call slot carries outcome fields; the at-call slot has
  // attribution but no status/duration/link.
  const hasOutcome = Boolean(push.status || push.duration || push.link);

  return {
    externalId: `${ROISTAT_EXTERNAL_ID_PREFIX}:${callId}`,
    provider: 'roistat',
    eventKey: hasOutcome ? 'roistat:after-call' : 'roistat:at-call',
    isAuthoritativeOutcome: hasOutcome,
    callerE164: normalizeE164(push.caller, push.callee),
    calleeDid: digitsOnly(push.callee) || undefined,
    occurredAt: parseRoistatTimestamp(push.date),
    callStatus: ROISTAT_STATUS_TO_CALL_STATUS[status],
    durationS: toDurationSeconds(push.duration),
    recordingUrl: String(push.link ?? '').trim() || undefined,
    attribution: {
      // Null for static tracking, populated for dynamic.
      roistatVisitId: push.visit_id ? String(push.visit_id) : undefined,
      // Roistat injects this per scenario; it is our project signal.
      projectCode: custom.project_id,
      utmSource: custom.utm_source,
      utmMedium: custom.utm_medium,
      utmCampaign: custom.utm_campaign,
      utmContent: custom.utm_content,
      utmTerm: custom.utm_term,
      landingPage: push.landing_page ?? undefined,
      referrer: push.referrer ?? undefined,
      googleClientId: push.google_client_id ?? undefined,
      ipAddress: push.ip ?? undefined,
      city: push.city ?? undefined,
      country: push.country ?? undefined,
      fbclid: custom.fbc,
      fbp: custom.fbp,
      distinctId: custom.posthog_id,
    },
    rawPayload: push,
    isTerminal: hasOutcome,
  };
};
