import gql from 'graphql-tag';

// Object/standalone SMS preflight: the alias determined from the chosen deal's
// project + whether the SMS may be sent (phone, project alias, consent).
export const RECORD_SMS_CONTEXT = gql`
  query RecordSmsContext($opportunityId: String, $personId: String) {
    recordSmsContext(opportunityId: $opportunityId, personId: $personId) {
      alias
      canSend
      reason
    }
  }
`;
