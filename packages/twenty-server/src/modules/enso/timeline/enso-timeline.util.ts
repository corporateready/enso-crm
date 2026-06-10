import { isDefined } from 'twenty-shared/utils';

// Reusable rich-timeline event for enso automation (company linking, B2B account
// deals, etc.), modeled on the consent timeline. Every event carries:
//   - ACTOR: workspaceMemberId (a human → "by {member}") OR auto:true (pipeline →
//     "automatically"). Never a generic "System" author.
//   - REASON: a human "why" string in properties.reason.
//   - CAUSE: the triggering/linked record (activity, deal, person, company) via
//     linkedRecord* + cachedName → clickable, like consent rows link their event.
// One timelineActivity row is written PER target so the event surfaces on each
// relevant timeline (person / company / opportunity).
//
// Frontend routes these by the `enso-event.` name prefix to a single generic row
// (EventRowEnsoEvent) that maps `action` → verb and renders reason + by/auto.
// Keep ENSO_EVENT_ACTIVITY_NAME_PREFIX in sync with the frontend.
export const ENSO_EVENT_ACTIVITY_NAME_PREFIX = 'enso-event';

export type EnsoTimelineTarget = {
  personId?: string | null;
  companyId?: string | null;
  opportunityId?: string | null;
};

export type EnsoTimelineEvent = {
  // → timelineActivity.name = `enso-event.<action>`; the front maps action to a verb.
  action: string;
  target: EnsoTimelineTarget;
  reason?: string | null;
  // true → row reads "automatically" (pipeline/system).
  auto?: boolean;
  // a human actor → row reads "by {member}". Omit for auto events.
  workspaceMemberId?: string | null;
  // The clickable linked record (its object metadata id + record id + a label).
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
      ...(isDefined(event.reason) && event.reason !== ''
        ? { reason: event.reason }
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
