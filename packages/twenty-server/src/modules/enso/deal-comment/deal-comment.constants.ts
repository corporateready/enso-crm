export const DEAL_COMMENT_OBJECT = 'dealComment';
export const DEAL_COMMENT_MENTION_OBJECT = 'dealCommentMention';

// Both objects are written only through createDealComment / deleteDealComment,
// so the "must mention someone" rule cannot be skipped through the generic API.
export const DEAL_COMMENT_GUARDED_OBJECTS: ReadonlySet<string> = new Set([
  DEAL_COMMENT_OBJECT,
  DEAL_COMMENT_MENTION_OBJECT,
]);

export const DEAL_COMMENT_MAX_BODY_LENGTH = 5000;

// The label identifier shown wherever a comment appears as a record chip.
export const DEAL_COMMENT_NAME_LENGTH = 80;
