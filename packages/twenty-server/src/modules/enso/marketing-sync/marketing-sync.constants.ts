import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';

import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

// The Dittofeed userId is always the CRM person UUID — the universal key.
// The CRM owns identity; Dittofeed never resolves or merges it.

export type MarketingSyncJobData =
  | {
      kind: 'identify';
      workspaceId: string;
      userId: string;
      traits: Record<string, unknown>;
      messageId: string;
    }
  | {
      kind: 'track';
      workspaceId: string;
      userId: string;
      event: string;
      properties: Record<string, unknown>;
      timestamp: string;
      messageId: string;
    }
  | {
      // deal_created: the listener only has the opportunity id; the worker job
      // enriches it (first-deal flag, project brand) from the ORM before track.
      kind: 'track_deal_created';
      workspaceId: string;
      userId: string;
      opportunityId: string;
      timestamp: string;
      messageId: string;
    };

// Track event names (Dittofeed journeys branch on these).
export const MARKETING_EVENT_DEAL_STAGE_CHANGED = 'deal_stage_changed';
// Fired when a deal is first created with a point of contact — the source
// event behind the per-development entry segments. Carries isFirstDealForPerson
// + projectName/projectCode, computed worker-side at emit (see MarketingSyncJob),
// so a segment like "New Artima Leads" can scope a journey to one development.
export const MARKETING_EVENT_DEAL_CREATED = 'deal_created';

// inboundActivity.kind → Dittofeed track event. Drives lifecycle journeys
// (form → intro drip) and the reply→drip-exit signal (inbound_message — a
// journey's engagement-exit node listens for it). Kinds match the enso
// inboundActivity SELECT values (see sequencing INBOUND_KIND_TO_CHANNEL).
export const INBOUND_ACTIVITY_EVENT_BY_KIND: Readonly<Record<string, string>> = {
  FORM_SUBMISSION: 'form_submitted',
  LEAD_AD: 'form_submitted',
  SOCIAL_MESSAGE: 'inbound_message',
  INCOMING_CALL: 'call_received',
  APPOINTMENT_BOOKED: 'appointment_booked',
};

// Minimal shape of the enso inboundActivity custom object (no generated entity
// for custom objects, so we type the event payload by hand).
export type InboundActivityRecord = {
  kind: string | null;
  personId: string | null;
  opportunityId: string | null;
  projectId: string | null;
  source: string | null;
  occurredAt: string | null;
  createdAt: string | null;
};

// Compose an E.164 number from Twenty's PHONES composite. Returns undefined
// when there's no number. callingCode may or may not carry a leading '+'.
export const toE164 = (
  callingCode: string | null | undefined,
  number: string | null | undefined,
): string | undefined => {
  if (!isNonEmptyString(number)) {
    return undefined;
  }

  if (!isNonEmptyString(callingCode)) {
    return number;
  }

  const normalizedCallingCode = callingCode.startsWith('+')
    ? callingCode
    : `+${callingCode}`;

  return `${normalizedCallingCode}${number}`;
};

// Curated v1 trait set — only fields that currently exist on Person and that
// marketing segments / templates actually use. Grows as custom fields land
// (language, country, consent flags). Undefined values are dropped so we never
// clobber a Dittofeed trait with null.
export const buildPersonTraits = (
  person: PersonWorkspaceEntity,
): Record<string, unknown> => {
  const traits: Record<string, unknown> = {
    firstName: person.name?.firstName,
    lastName: person.name?.lastName,
    email: person.emails?.primaryEmail,
    phone: toE164(
      person.phones?.primaryPhoneCallingCode,
      person.phones?.primaryPhoneNumber,
    ),
    city: person.city,
    jobTitle: person.jobTitle,
    companyId: person.companyId,
    createdAt: person.createdAt,
  };

  return Object.fromEntries(
    Object.entries(traits).filter(([, value]) => isDefined(value)),
  );
};
