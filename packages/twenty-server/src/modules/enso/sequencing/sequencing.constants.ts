// Sequencing scanner — time-based cadence + stall + auto-close for Lead Claimed runs.
// Event pieces (first touch on claim, reply -> Connected) live in workflows; this
// backend cron sweeps open sequence runs and acts on live deal state.

export const SEQUENCING_SCANNER_CRON_PATTERN = '* * * * *';

export const LEAD_CLAIMED_STAGE = 'LEAD_CLAIMED';
export const CLOSED_LOST_STAGE = 'CLOSED_LOST';
export const CLOSED_STAGES: readonly string[] = ['CLOSED_WON', 'CLOSED_LOST'];
export const STALLED_PIPELINE_STATE = 'STALLED';
export const UNREACHABLE_LOST_REASON = 'UNREACHABLE';

const DAY_MS = 24 * 60 * 60 * 1000;

// Manager follow-up touches after the day-0 first touch (created by the workflow).
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
