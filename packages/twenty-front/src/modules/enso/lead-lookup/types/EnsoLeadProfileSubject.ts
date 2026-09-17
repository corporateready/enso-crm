// What a lead profile was opened on: a contact from a contact match, or a deal
// from a deal match, which the server resolves back to its contact.
export type EnsoLeadProfileSubject = {
  personId: string | null;
  opportunityId: string | null;
};
