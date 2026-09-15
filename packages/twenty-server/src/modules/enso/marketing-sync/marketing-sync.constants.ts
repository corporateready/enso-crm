import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';

import { toE164 } from 'src/modules/enso/shared/utils/person-phone.util';
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
    }
  | {
      // Consent mirror, legacy payload: `changes` is Dittofeed's
      // {subscriptionGroupId: isSubscribed} map, already resolved by the
      // listener. Only jobs queued before subscription groups moved onto the
      // Project record look like this — kept so a rolling deploy drains the
      // queue instead of dropping it, and removable once the queue has turned
      // over.
      kind: 'sync_consent';
      workspaceId: string;
      userId: string;
      changes: Record<string, boolean>;
      messageId: string;
    }
  | {
      // Consent mirror: CRM personProjectConsent → Dittofeed subscription
      // state, so a person the CRM marks opted-out is suppressed at send. The
      // listener carries the project and the consent row; the worker resolves
      // which subscription groups that project has (same split as
      // track_deal_created), because the mapping now lives on the Project
      // record and only the worker touches the ORM.
      kind: 'sync_consent';
      workspaceId: string;
      userId: string;
      projectId: string;
      consent: PersonProjectConsentRecord;
      revokedChannels: ConsentChannel[];
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
export const INBOUND_ACTIVITY_EVENT_BY_KIND: Readonly<Record<string, string>> =
  {
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

// The four marketing-consent channels on personProjectConsent. The per-channel
// boolean field is `${channel}MarketingConsent`.
export const CONSENT_CHANNELS = ['email', 'sms', 'whatsapp', 'call'] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];

// personProjectConsent boolean fields a consent change re-syncs on (a row edit
// that touches none of these — e.g. just `name` — must not re-push).
export const CONSENT_CONSENT_FIELDS: ReadonlySet<string> = new Set(
  CONSENT_CHANNELS.map((channel) => `${channel}MarketingConsent`),
);

// Minimal shape of the enso personProjectConsent custom object event payload.
export type PersonProjectConsentRecord = {
  id: string;
  personId: string | null;
  projectId: string | null;
  emailMarketingConsent: boolean | null;
  smsMarketingConsent: boolean | null;
  whatsappMarketingConsent: boolean | null;
  callMarketingConsent: boolean | null;
  updatedAt: string | null;
};

// Which Project field carries each channel's Dittofeed subscription group id.
// Reading these off the Project record is what lets marketing configure a new
// development in the CRM instead of editing this file and waiting for a deploy.
// A channel with no field provisioned (or an empty one) simply resolves to no
// group, so whatsapp/call can be added later by running the provisioning
// script again — no code change.
//   packages/twenty-server/scripts/provision-project-subscription-groups.mjs
export const SUBSCRIPTION_GROUP_FIELD_BY_CHANNEL: Readonly<
  Record<ConsentChannel, string>
> = {
  email: 'dittofeedEmailSubscriptionGroupId',
  sms: 'dittofeedSmsSubscriptionGroupId',
  whatsapp: 'dittofeedWhatsappSubscriptionGroupId',
  call: 'dittofeedCallSubscriptionGroupId',
};

// A project's per-channel subscription group ids, read off the Project record.
// This is the only source now: the hardcoded PROJECT_SUBSCRIPTION_GROUPS
// fallback existed to carry the two pilots across the migration and was deleted
// once both records were backfilled. A project with no ids set is simply not
// mirrored, and the worker says so. `project` is the raw ORM row (or null when
// the project is gone).
export const resolveProjectSubscriptionGroups = (
  project: Record<string, unknown> | null | undefined,
): Partial<Record<ConsentChannel, string>> => {
  const groups: Partial<Record<ConsentChannel, string>> = {};

  for (const channel of CONSENT_CHANNELS) {
    const raw = project?.[SUBSCRIPTION_GROUP_FIELD_BY_CHANNEL[channel]];
    // Check AFTER trimming, not before: isNonEmptyString('   ') is true, so a
    // whitespace-only field would otherwise resolve to an empty group id and
    // the mirror would push consent at nothing.
    const groupId = isNonEmptyString(raw) ? raw.trim() : undefined;

    if (isNonEmptyString(groupId)) {
      groups[channel] = groupId;
    }
  }

  return groups;
};

// Resolve a consent row to Dittofeed's {subscriptionGroupId: isSubscribed} map.
// Empty when the project has no groups at all (→ nothing to mirror). OptOut
// groups: isSubscribed=false suppresses the person at send time.
export const buildConsentSubscriptionChanges = (
  groups: Partial<Record<ConsentChannel, string>>,
  record: PersonProjectConsentRecord,
): Record<string, boolean> => {
  const changes: Record<string, boolean> = {};

  for (const channel of CONSENT_CHANNELS) {
    const subscriptionGroupId = groups[channel];

    if (!isNonEmptyString(subscriptionGroupId)) {
      continue;
    }

    changes[subscriptionGroupId] =
      record[`${channel}MarketingConsent`] === true;
  }

  return changes;
};

// Channels whose consent went from granted to not-granted in one edit. A grant
// that fails to reach Dittofeed only costs us marketing; a REVOCATION that
// fails to reach it means we keep sending to someone who asked us to stop, so
// the two cases are reported at different volumes and severities.
export const revokedConsentChannels = (
  before: PersonProjectConsentRecord,
  after: PersonProjectConsentRecord,
): ConsentChannel[] =>
  CONSENT_CHANNELS.filter(
    (channel) =>
      before[`${channel}MarketingConsent`] === true &&
      after[`${channel}MarketingConsent`] !== true,
  );

// Curated v1 trait set — only fields that currently exist on Person and that
// marketing segments / templates actually use. Grows as custom fields land
// (language, country, consent flags). Undefined values are dropped so we never
// clobber a Dittofeed trait with null.
// Person.languages is a workspace multi-select — read the first code (e.g.
// 'RO'/'RU') as a scalar `language` trait so Dittofeed journeys can branch on it.
const firstLanguage = (person: PersonWorkspaceEntity): string | undefined => {
  const languages = (person as unknown as { languages?: string[] | null })
    .languages;

  return Array.isArray(languages) ? languages[0] : undefined;
};

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
    language: firstLanguage(person),
    createdAt: person.createdAt,
  };

  return Object.fromEntries(
    Object.entries(traits).filter(([, value]) => isDefined(value)),
  );
};
