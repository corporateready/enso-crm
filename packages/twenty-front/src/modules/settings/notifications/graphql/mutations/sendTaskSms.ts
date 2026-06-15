import gql from 'graphql-tag';

export const SEND_TASK_SMS = gql`
  mutation SendTaskSms($taskId: String!, $message: String!, $alias: String) {
    sendTaskSms(taskId: $taskId, message: $message, alias: $alias) {
      success
      error
    }
  }
`;
