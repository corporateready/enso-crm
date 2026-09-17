// A person's OWN column widths, one row per person on core.keyValuePair with
// `userId` set — the same shape as their own default views.
//
// Widths are personal rather than a property of the view because a view is
// shared. A member whose role lacks the VIEWS permission flag cannot write to a
// role view at all, so their drag was discarded and the column snapped back on
// the next load; and an admin's drag reshaped the table for the whole team.
// The view's own sizes stay the baseline for anyone who has never dragged that
// column.
export const ENSO_USER_COLUMN_WIDTHS_KEY = 'ENSO_USER_COLUMN_WIDTHS';

// Same floor the table enforces client-side (RECORD_TABLE_COLUMN_MIN_WIDTH);
// the ceiling only exists so a bad write cannot store a column wider than any
// screen and leave someone unable to reach the others.
export const ENSO_COLUMN_WIDTH_MIN = 104;
export const ENSO_COLUMN_WIDTH_MAX = 2000;
