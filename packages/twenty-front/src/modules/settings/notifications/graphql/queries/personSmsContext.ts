import gql from 'graphql-tag';

// Object/launcher SMS preflight. With a deal in context the sender is that
// deal's project brand (authoritative, single alias) gated on consent for that
// project; with no deal, it falls back to the contact's consented brands.
export const PERSON_SMS_CONTEXT = gql`
  query PersonSmsContext($personId: String, $opportunityId: String) {
    personSmsContext(personId: $personId, opportunityId: $opportunityId) {
      aliases
      canSend
      reason
    }
  }
`;
