// Hourly: an unfinished family link is junk, so it should not linger, and the
// same pass keeps households in step with the links.
export const PERSON_RELATIONSHIP_DRAFT_CLEANUP_CRON_PATTERN = '17 * * * *';

// A draft untouched this long was abandoned. The Family tab's "Add relative"
// never saves a half-filled link, so only edits made elsewhere (the Family
// Links table, the API) can leave one.
export const PERSON_RELATIONSHIP_DRAFT_MAX_AGE_HOURS = 1;
