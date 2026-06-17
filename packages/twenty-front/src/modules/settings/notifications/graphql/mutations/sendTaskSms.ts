import gql from 'graphql-tag';

// The sender alias is resolved server-side from the deal's project (never the
// client), so the mutation only takes the task + message.
export const SEND_TASK_SMS = gql`
  mutation SendTaskSms($taskId: String!, $message: String!) {
    sendTaskSms(taskId: $taskId, message: $message) {
      success
      error
    }
  }
`;
