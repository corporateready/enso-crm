// Stage-2 identity resolution: when a Person gains a phone/email (a social
// name-only contact gets a number in conversation, or a new inbound arrives
// with contact details), reconcile duplicates that share that phone/email.
// Mirrors the legacy Attio "Merging Contacts" workflow (match by email or
// phone; oldest record kept) — but the phone comparison is ours, not Attio's
// blind last-9 suffix, which merged different lines together (phone-match.util).

// Relations whose person foreign key must be re-pointed from a merged-away
// duplicate to the kept Person. Each reassignment is best-effort (wrapped in
// try/catch) so a unique-constraint clash on one junction never aborts the whole
// merge. (Core targets like taskTarget/noteTarget are deferred — leads rarely
// carry those before a merge.)
export const PERSON_RELATION_REASSIGNMENTS: {
  object: string;
  field: string;
}[] = [
  { object: 'opportunity', field: 'pointOfContactId' },
  { object: 'inboundActivity', field: 'personId' },
  { object: 'personProjectConsent', field: 'personId' },
  { object: 'personProjectAssignment', field: 'personId' },
  { object: 'personRelationship', field: 'personId' },
  { object: 'personRelationship', field: 'relatedPersonId' },
];

// Ceiling on how many records one automatic merge may consume. Above this the
// executor refuses the whole set and deletes nothing: a group that big is a
// matcher fault, not a person, and the failure mode we are guarding against is
// one bad trigger soft-deleting a pile of real contacts (which happened — a
// single API-created person collapsed 17 records that merely shared a phone
// suffix). The largest genuine group in production is 2, and one human arriving
// by form, call and social is about 3, so this leaves real headroom.
// Deliberately independent of the matcher: it also bounds the NEXT matcher bug.
export const MAX_AUTO_MERGE_SET_SIZE = 5;
