// A person was created or updated — check whether it now shares a phone/email
// with other people and, if so, merge them.
export type FindPersonDuplicatesJobData = {
  workspaceId: string;
  personId: string;
};

// Merge a confirmed duplicate set into the oldest record.
export type MergePersonDuplicatesJobData = {
  workspaceId: string;
  // All person ids known to share a phone/email (including the trigger). The
  // executor re-loads them, picks the oldest as keeper, and merges the rest.
  personIds: string[];
};
