// Body of POST /webhooks/enso/consent-unsubscribe — pushed by a Dittofeed
// reverse journey (entry on a subscription group's "unsubscribed" segment →
// Webhook node). workspaceId is the CRM workspace (no auth context on the
// public webhook); userId is the CRM person UUID; projectId + channel scope the
// revoke to one personProjectConsent row + channel (per-project × channel).

// The four marketing-consent channels, lowercase to match the
// `${channel}MarketingConsent` fields on personProjectConsent.
export const CONSENT_UNSUBSCRIBE_CHANNELS = [
  'email',
  'sms',
  'whatsapp',
  'call',
] as const;

export type ConsentUnsubscribeChannel =
  (typeof CONSENT_UNSUBSCRIBE_CHANNELS)[number];

// personProjectConsentEvent.method enum (how the opt-out happened).
export const CONSENT_REVOKE_METHODS = [
  'UNSUBSCRIBE',
  'SMS_STOP',
  'WHATSAPP_OPTOUT',
  'MANUAL',
  'VERBAL_REQUEST',
  'COMPLAINT',
  'LEGAL_ERASURE',
  'OTHER',
] as const;

export type ConsentRevokeMethod = (typeof CONSENT_REVOKE_METHODS)[number];

export type ConsentUnsubscribeInput = {
  workspaceId: string;
  userId: string;
  projectId: string;
  channel: ConsentUnsubscribeChannel;
  // Defaults to UNSUBSCRIBE (the email link). The reverse journey may send
  // SMS_STOP / WHATSAPP_OPTOUT for those channels.
  method?: ConsentRevokeMethod;
  occurredAt?: string;
};

export const isConsentUnsubscribeChannel = (
  value: unknown,
): value is ConsentUnsubscribeChannel =>
  CONSENT_UNSUBSCRIBE_CHANNELS.includes(value as ConsentUnsubscribeChannel);

export const isConsentRevokeMethod = (
  value: unknown,
): value is ConsentRevokeMethod =>
  CONSENT_REVOKE_METHODS.includes(value as ConsentRevokeMethod);
