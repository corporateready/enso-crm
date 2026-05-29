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

// Dedup boundary: an inbound for a (person × project) attaches to an existing
// open opportunity only if it was created within this window. Older/closed
// leads start a fresh deal. (See content/docs/domains/leads.md "Resolving to a Deal".)
export const DEAL_DEDUP_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

// Claim window: after assignment the manager has this long to claim before the
// opportunity is rerouted. Overridable for testing via env.
export const CLAIM_WINDOW_MS = Number(
  process.env.ENSO_CLAIM_WINDOW_MS ?? 3 * 60 * 1000,
);

// After this many routing attempts, stop rerouting and escalate to ops.
export const MAX_ROUTING_ATTEMPTS = 5;

// inboundActivity.source (or kind) → opportunity.source. Both are SELECT enums;
// the activity already carries a normalized source, so this is mostly identity
// with a safe fallback for anything unmapped.
export const ACTIVITY_SOURCE_TO_OPPORTUNITY_SOURCE: Record<string, string> = {
  FORM_WEBSITE: 'FORM_WEBSITE',
  CALL_INBOUND: 'CALL_INBOUND',
  SOCIAL_DM: 'SOCIAL_DM',
  LEAD_AD: 'LEAD_AD',
  REFERRAL: 'REFERRAL',
  WALK_IN: 'WALK_IN',
  MANUAL: 'MANUAL',
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

export const mapOpportunitySource = (activitySource?: string | null): string =>
  (activitySource && ACTIVITY_SOURCE_TO_OPPORTUNITY_SOURCE[activitySource]) ||
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
