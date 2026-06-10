import { isDefined } from 'twenty-shared/utils';

// Reusable rich-timeline event for enso automation (company linking, B2B account
// deals, etc.), modeled on the consent timeline. Every event carries:
//   - A plain-English SENTENCE composed of `segments` (text runs + clickable
//     record links) so the row reads naturally with good navigation.
//   - ACTOR: workspaceMemberId (a human → "by {member}") OR auto:true (pipeline →
//     "automatically"). Never a generic "System" author.
// One timelineActivity row is written PER target so the event surfaces on each
// relevant timeline (person / company / opportunity).
//
// Frontend routes these by the `enso-event.` name prefix to a single row
// (EventRowEnsoEvent) that renders the segments + the actor suffix. Keep
// ENSO_EVENT_ACTIVITY_NAME_PREFIX in sync with the frontend.
export const ENSO_EVENT_ACTIVITY_NAME_PREFIX = 'enso-event';

export type EnsoTimelineTarget = {
  personId?: string | null;
  companyId?: string | null;
  opportunityId?: string | null;
};

// A sentence is built from segments: plain text, or a clickable link to a record.
// The backend composes the full plain-English sentence; the frontend renders text
// runs as-is and link segments as clickable chips (open record in side panel).
export type EnsoTimelineSegment =
  | { text: string }
  | { label: string; objectNameSingular: string; recordId: string };

export type EnsoTimelineEvent = {
  // → timelineActivity.name = `enso-event.<action>` (drives the row icon).
  action: string;
  target: EnsoTimelineTarget;
  // The readable sentence as segments (preferred). e.g.
  //   [{text:'Linked to '},{label:'Stripe',objectNameSingular:'company',recordId},
  //    {text:' — work-email domain stripe.com is a company domain'}]
  segments?: EnsoTimelineSegment[];
  // true → sentence ends "— automatically" (pipeline/system).
  auto?: boolean;
  // a human actor → ends "— by {member}". Omit for auto events.
  workspaceMemberId?: string | null;
  // Optional: a primary linked record, used for the row ICON (and as a fallback
  // click target). The sentence's own link segments are the main navigation.
  linkedObjectMetadataId?: string | null;
  linkedRecordId?: string | null;
  linkedRecordCachedName?: string | null;
  // Defaults to now (plain server code — new Date() is fine here).
  happensAt?: string;
};

// Builds one timelineActivity insert row per provided target id. The caller
// inserts the rows with the workspace 'timelineActivity' repository (must already
// be inside an executeInWorkspaceContext block).
export const buildEnsoTimelineInserts = (
  event: EnsoTimelineEvent,
): Record<string, unknown>[] => {
  const base: Record<string, unknown> = {
    name: `${ENSO_EVENT_ACTIVITY_NAME_PREFIX}.${event.action}`,
    happensAt: event.happensAt ?? new Date().toISOString(),
    linkedRecordCachedName: event.linkedRecordCachedName ?? '',
    properties: {
      action: event.action,
      ...(isDefined(event.segments) && event.segments.length > 0
        ? { segments: event.segments }
        : {}),
      ...(event.auto === true ? { auto: true } : {}),
    },
    ...(isDefined(event.linkedObjectMetadataId)
      ? { linkedObjectMetadataId: event.linkedObjectMetadataId }
      : {}),
    ...(isDefined(event.linkedRecordId)
      ? { linkedRecordId: event.linkedRecordId }
      : {}),
    ...(isDefined(event.workspaceMemberId)
      ? { workspaceMemberId: event.workspaceMemberId }
      : {}),
  };

  const rows: Record<string, unknown>[] = [];

  if (isDefined(event.target.personId)) {
    rows.push({ ...base, targetPersonId: event.target.personId });
  }
  if (isDefined(event.target.companyId)) {
    rows.push({ ...base, targetCompanyId: event.target.companyId });
  }
  if (isDefined(event.target.opportunityId)) {
    rows.push({ ...base, targetOpportunityId: event.target.opportunityId });
  }

  return rows;
};
