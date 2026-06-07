// Shared shape for the "duplicates merged" timeline activity written by BOTH
// person-merge and company-merge executors. Surfaces the merge on the keeper's
// timeline so a manager can see where a vanished record went (the merged-away
// duplicate is soft-deleted, so there's no live record to link to — the
// identifiers are carried in linkedRecordCachedName + properties instead).
//
// The frontend routes this by `name`: EventRowDynamicComponent /
// EventIconDynamicComponent special-case ENSO_RECORD_MERGED_ACTIVITY_NAME.
// Keep that string in sync with the frontend.
export const ENSO_RECORD_MERGED_ACTIVITY_NAME = 'enso-record.merged';

export type MergeTimelineParams = {
  // Which timeline the row appears on.
  targetObject: 'person' | 'company';
  // The surviving record (oldest).
  keeperId: string;
  // What the duplicates were matched on, e.g. 'email', 'phone', 'email/phone',
  // 'registration number', 'domain', 'registration number/domain'.
  matchedOn: string;
  // Human identifiers of the absorbed records (name / email / domain / VAT / id).
  mergedLabels: string[];
};

// Builds the timelineActivity insert payload. happensAt is stamped here (plain
// server code — not a workflow script — so new Date() is fine).
export const buildMergeTimelineActivityInsert = (
  params: MergeTimelineParams,
): Record<string, unknown> => {
  const targetField =
    params.targetObject === 'person' ? 'targetPersonId' : 'targetCompanyId';

  return {
    [targetField]: params.keeperId,
    name: ENSO_RECORD_MERGED_ACTIVITY_NAME,
    happensAt: new Date().toISOString(),
    linkedRecordCachedName: params.mergedLabels.join(', '),
    properties: {
      matchedOn: params.matchedOn,
      mergedCount: params.mergedLabels.length,
      mergedLabels: params.mergedLabels,
    },
  };
};
