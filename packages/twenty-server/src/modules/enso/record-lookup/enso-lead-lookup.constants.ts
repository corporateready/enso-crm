// Short terms match half the database and teach a manager nothing, so they are
// rejected before they cost an allowance.
export const ENSO_LEAD_LOOKUP_MIN_TERM_LENGTH = 3;

export const ENSO_LEAD_LOOKUP_MAX_MATCHES = 10;

// Enough for a normal day of "have we spoken to this person before?", far too
// few to walk the book one search at a time.
export const ENSO_LEAD_LOOKUP_DAILY_ALLOWANCE = 30;
