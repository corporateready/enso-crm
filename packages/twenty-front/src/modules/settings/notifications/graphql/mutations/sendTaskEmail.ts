import gql from 'graphql-tag';

// 1:1 email from a task, sent from the manager's OWN connected mailbox
// (resolved server-side, never trusted from the client). Logs an
// outboundActivity(channel: EMAIL) and links it to the task.
export const SEND_TASK_EMAIL = gql`
  mutation SendTaskEmail($taskId: String!, $subject: String!, $body: String!) {
    sendTaskEmail(taskId: $taskId, subject: $subject, body: $body) {
      success
      error
    }
  }
`;
