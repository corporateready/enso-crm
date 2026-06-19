import gql from 'graphql-tag';

// Object/launcher corporate SMS: send to a contact under a consented sender
// alias (validated server-side); optional deal + task link the activity.
export const SEND_PERSON_SMS = gql`
  mutation SendPersonSms(
    $personId: String
    $message: String!
    $alias: String
    $opportunityId: String
    $taskId: String
  ) {
    sendPersonSms(
      personId: $personId
      message: $message
      alias: $alias
      opportunityId: $opportunityId
      taskId: $taskId
    ) {
      success
      error
    }
  }
`;
