// Inbound payload from a Dittofeed journey's Webhook-channel Message node
// (connection (4) — journey state pushed back to the CRM). One POST per user
// per milestone. `userId` is the CRM person UUID (the universal key), so no
// identity resolution is ever needed. See docs/marketing-engine-dittofeed.md
// → "Marketing-journey visibility in the CRM".

export const MARKETING_ENROLLMENT_STATUSES = [
  'ACTIVE',
  'FINISHED',
  'EXITED',
] as const;

export type MarketingEnrollmentStatus =
  (typeof MARKETING_ENROLLMENT_STATUSES)[number];

export type JourneyCallbackInput = {
  // The enso workspace id — supplied in the body because this is an
  // unauthenticated machine call with no JWT to derive it from.
  workspaceId: string;
  // CRM person UUID = Dittofeed userId.
  userId: string;
  // Stable journey key, e.g. "ARTIMA_INTRO".
  journey: string;
  // The milestone just reached, e.g. "entered" / "email_2_sent".
  step: string;
  status: MarketingEnrollmentStatus;
  // ISO timestamp; defaults to now when absent.
  occurredAt?: string;
  // Dittofeed's internal journey id, to correlate with the deliveries API.
  dittofeedJourneyId?: string;
  // The opportunity that triggered enrollment (deal-driven journeys), if any.
  sourceOpportunityId?: string;
};

export const isMarketingEnrollmentStatus = (
  value: unknown,
): value is MarketingEnrollmentStatus =>
  typeof value === 'string' &&
  (MARKETING_ENROLLMENT_STATUSES as readonly string[]).includes(value);
