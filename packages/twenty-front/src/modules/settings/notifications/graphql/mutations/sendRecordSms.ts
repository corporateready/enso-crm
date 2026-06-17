import gql from 'graphql-tag';

// Corporate SMS from a record (no task). Alias + consent resolved server-side
// from the chosen deal's project; logs an outboundActivity (deal + contact).
export const SEND_RECORD_SMS = gql`
  mutation SendRecordSms(
    $opportunityId: String
    $personId: String
    $message: String!
  ) {
    sendRecordSms(
      opportunityId: $opportunityId
      personId: $personId
      message: $message
    ) {
      success
      error
    }
  }
`;
