// Sequencing scanner — time-based cadence + stall + auto-close for Lead Claimed runs.
// Event pieces (first touch on claim, reply -> Connected) live in workflows; this
// backend cron sweeps open sequence runs and acts on live deal state.

export const SEQUENCING_SCANNER_CRON_PATTERN = '* * * * *';

export const LEAD_CLAIMED_STAGE = 'LEAD_CLAIMED';
export const CONNECTED_STAGE = 'CONNECTED';
export const CLOSED_LOST_STAGE = 'CLOSED_LOST';
export const CLOSED_STAGES: readonly string[] = ['CLOSED_WON', 'CLOSED_LOST'];
export const STALLED_PIPELINE_STATE = 'STALLED';
export const UNREACHABLE_LOST_REASON = 'UNREACHABLE';

// Reply observer: an inbound social message after enrollment = two-way human
// contact, so the deal advances Lead Claimed -> Connected and the run ends.
// Native message tables are empty on this instance; all inbound lead activity
// lives in the ENSO `inboundActivity` object, which carries opportunityId.
export const INBOUND_SOCIAL_MESSAGE_KIND = 'SOCIAL_MESSAGE';
export const SOCIAL_FIRST_CONTACT_CHANNEL = 'SOCIAL';

// Origin-channel detection. firstContactChannel is null on deals at claim time
// (intake doesn't set it), so a deal's channel is derived from its earliest
// inbound activity kind. Deals with no/unknown origin default to social.
export const CHANNEL_SOCIAL = 'SOCIAL';
export const INBOUND_KIND_TO_CHANNEL: Readonly<Record<string, string>> = {
  SOCIAL_MESSAGE: 'SOCIAL',
  INCOMING_CALL: 'CALL',
  FORM_SUBMISSION: 'FORM',
  LEAD_AD: 'FORM',
};

// Only social has a live sequence today; runs enrolled for any other origin
// channel are ended (SUPERSEDED) rather than driven through the social cadence.
export const CHANNELS_WITH_LIVE_SEQUENCE: readonly string[] = [CHANNEL_SOCIAL];
export const SEQUENCE_RUN_END_REASON_SUPERSEDED = 'SUPERSEDED';

const DAY_MS = 24 * 60 * 60 * 1000;

// Enrollment (now owned by the scanner, not the workflow). The first touch is
// the day-0 manager task created at enrollment; stepKey feeds the step funnel.
export const FIRST_TOUCH_STEP_KEY = 'social.lead_claimed.msg1';
export const FIRST_TOUCH_TITLE_PREFIX = 'First touch';

// A sequence row's slot for the forward (non-reactivation) Lead Claimed path.
export const SEQUENCE_PIPELINE_STATE_ACTIVE = 'ACTIVE';
// Fallback variant tag when a sequence row has no variant set.
export const DEFAULT_VARIANT = 'v1';

// Manager follow-up touches after the day-0 first touch.
// stepKey must match what analytics/the step funnel group on.
export const SOCIAL_LEAD_CLAIMED_FOLLOWUPS: readonly {
  stepKey: string;
  afterMs: number;
}[] = [
  { stepKey: 'social.lead_claimed.followup_1d', afterMs: 1 * DAY_MS },
  { stepKey: 'social.lead_claimed.followup_3d', afterMs: 3 * DAY_MS },
];

// Stall once the cadence is exhausted; auto-close (Unreachable) after the grace window.
export const SOCIAL_LEAD_CLAIMED_STALL_AFTER_MS = 3 * DAY_MS;
export const SOCIAL_LEAD_CLAIMED_CLOSE_AFTER_STALL_MS = 7 * DAY_MS;

// End reasons written on the sequence run. Must match the `endReason` SELECT
// option values (uppercase enum) created on the sequenceRun object.
export const SEQUENCE_RUN_END_REASON_ADVANCED = 'ADVANCED';
export const SEQUENCE_RUN_END_REASON_CLOSED = 'CLOSED';
