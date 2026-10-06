// Manual lead entry: a manager adds a lead they found themselves. It enters as
// an inbound activity like every other lead (docs/manual-lead-entry.md).

export const MANUAL_ENTRY_ACTIVITY_KIND = 'MANUAL_ENTRY';
export const MANUAL_ENTRY_ACTIVITY_SOURCE = 'MANUAL';

// Who works the lead once it is in.
export const MANUAL_LEAD_DESTINATIONS = [
  'MINE',
  'COLLEAGUE',
  'ROUTING',
] as const;

export type ManualLeadDestination = (typeof MANUAL_LEAD_DESTINATIONS)[number];

// Stages a hand-added lead may start in when its manager keeps it. Capped at
// Connected until the later stages have their fields (user decision
// 2026-10-06); widening this list is all it takes, the form then asks for that
// stage's required fields.
export const MANUAL_LEAD_START_STAGES = ['LEAD_CLAIMED', 'CONNECTED'] as const;

// opportunity.firstContactChannel options.
export const FIRST_CONTACT_CHANNELS = [
  'CALL',
  'SOCIAL',
  'MESSAGE',
  'SMS',
  'WHATSAPP',
  'VIBER',
  'TELEGRAM',
  'EMAIL',
] as const;

// Channels a client can agree to out loud; the names ConsentFromActivityService
// uses for the personProjectConsent columns.
export const VERBAL_CONSENT_CHANNELS = ['email', 'sms', 'whatsapp', 'call'];

export const MANUAL_LEAD_FIRST_CONTACT_STEP_KEY =
  'manual.lead_claimed.first_contact';

// The duplicate check reads past record visibility, so it is counted like the
// lead lookup. It only answers exact phone/email matches, so the allowance is
// looser than the lookup's.
export const MANUAL_LEAD_DUPLICATE_CHECK_DAILY_ALLOWANCE = 100;

// A form left open for a while still submits fine; a date further ahead than
// this is a typo.
export const MANUAL_LEAD_FUTURE_TOLERANCE_MS = 10 * 60 * 1000;
