// Daily, off-hours: abandoned family-link drafts are clutter, not urgent.
export const PERSON_RELATIONSHIP_DRAFT_CLEANUP_CRON_PATTERN = '17 3 * * *';

// A draft untouched this long was abandoned. Long enough that nobody loses a
// link they are still filling in.
export const PERSON_RELATIONSHIP_DRAFT_MAX_AGE_HOURS = 24;
