import gql from 'graphql-tag';

// Object/standalone 1:1 email to a contact (optional deal), from the manager's
// OWN connected mailbox; logs an outboundActivity(channel: EMAIL) without a task.
export const SEND_RECORD_EMAIL = gql`
  mutation SendRecordEmail(
    $opportunityId: String
    $personId: String
    $subject: String!
    $body: String!
  ) {
    sendRecordEmail(
      opportunityId: $opportunityId
      personId: $personId
      subject: $subject
      body: $body
    ) {
      success
      error
    }
  }
`;
