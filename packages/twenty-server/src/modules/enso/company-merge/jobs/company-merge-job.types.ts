// A company was created/updated (or just enriched) — check whether it now shares
// a registration number / domain with other companies and, if so, merge them.
export type FindCompanyDuplicatesJobData = {
  workspaceId: string;
  companyId: string;
};

// Merge a confirmed duplicate set into the oldest record.
export type MergeCompanyDuplicatesJobData = {
  workspaceId: string;
  // All company ids known to share a registration number / domain (including the
  // trigger). The executor re-loads them, picks the oldest as keeper, merges the
  // rest.
  companyIds: string[];
};
