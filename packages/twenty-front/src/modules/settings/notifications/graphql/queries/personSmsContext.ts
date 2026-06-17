import gql from 'graphql-tag';

// Object/launcher SMS preflight: the sender aliases this contact may be reached
// under (their consented projects' brands), and whether SMS may be sent at all.
export const PERSON_SMS_CONTEXT = gql`
  query PersonSmsContext($personId: String) {
    personSmsContext(personId: $personId) {
      aliases
      canSend
      reason
    }
  }
`;
