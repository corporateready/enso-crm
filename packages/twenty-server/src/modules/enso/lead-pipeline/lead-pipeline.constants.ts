// Shared constants for the inbound-activity → opportunity → routing pipeline.

// Raw inserts/updates bypass the create resolver that normally fills the
// `createdBy` / `updatedBy` ACTOR from auth context (those columns are NOT
// NULL). Pipeline-created records are system-generated, so stamp them as SYSTEM.
export const SYSTEM_ACTOR = {
  source: 'SYSTEM',
  name: 'System',
  context: {},
} as const;

// Opportunity stages that are terminal — a closed deal never dedups against a
// fresh inbound (re-engagement opens a new opportunity).
export const CLOSED_OPPORTUNITY_STAGES = ['CLOSED_WON', 'CLOSED_LOST'] as const;

// Dedup is by (person × project) over OPEN deals with NO time window — an
// inbound attaches to any non-closed deal for that pair regardless of age
// (matches legacy Attio's "ever exists"); only a closed deal lets a fresh
// inquiry open a new one. (See content/docs/systems/lead-pipeline.md.)

// Claim window: after assignment the manager has this long to claim before the
// opportunity is rerouted. Overridable for testing via env.
export const CLAIM_WINDOW_MS = Number(
  process.env.ENSO_CLAIM_WINDOW_MS ?? 3 * 60 * 1000,
);

// After this many routing attempts, stop rerouting and escalate to ops.
export const MAX_ROUTING_ATTEMPTS = 5;

// inboundActivity.kind → opportunity.source. The activity's `source` enum
// describes the transport (WEBSITE/ROISTAT/META/…), not the deal source, so the
// deal source is derived from the activity KIND. Unmapped kinds fall back to OTHER.
export const ACTIVITY_KIND_TO_OPPORTUNITY_SOURCE: Record<string, string> = {
  FORM_SUBMISSION: 'FORM_WEBSITE',
  INCOMING_CALL: 'CALL_INBOUND',
  CALLBACK_REQUEST: 'CALL_INBOUND',
  SOCIAL_MESSAGE: 'SOCIAL_DM',
  LEAD_AD: 'LEAD_AD',
  APPOINTMENT_BOOKED: 'MANUAL',
};

// Human label per opportunity source, used in the composite opportunity name
// ("Form | +373… | ARTIMA").
export const OPPORTUNITY_SOURCE_LABEL: Record<string, string> = {
  FORM_WEBSITE: 'Form',
  CALL_INBOUND: 'Call',
  SOCIAL_DM: 'Social',
  LEAD_AD: 'Lead Ad',
  REFERRAL: 'Referral',
  WALK_IN: 'Walk-in',
  MANUAL: 'Manual',
  OTHER: 'Lead',
};

export const mapOpportunitySource = (activityKind?: string | null): string =>
  (activityKind && ACTIVITY_KIND_TO_OPPORTUNITY_SOURCE[activityKind]) ||
  'OTHER';

// opportunity.firstTrafficType SELECT options. The activity's trafficType is
// copied onto the frozen snapshot only if it's a valid opportunity value —
// guards the insert against an unexpected enum from a future intake channel.
export const OPPORTUNITY_TRAFFIC_TYPES = [
  'PAID',
  'ORGANIC',
  'DIRECT',
  'SOCIAL',
  'EMAIL',
  'REFERRAL',
  'OTHER',
] as const;

export const coerceTrafficType = (value?: string | null): string | null =>
  value && (OPPORTUNITY_TRAFFIC_TYPES as readonly string[]).includes(value)
    ? value
    : null;
