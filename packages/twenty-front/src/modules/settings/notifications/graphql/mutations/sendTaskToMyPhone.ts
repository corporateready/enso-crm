import gql from 'graphql-tag';

export const SEND_TASK_TO_MY_PHONE = gql`
  mutation SendTaskToMyPhone($taskId: String!) {
    sendTaskToMyPhone(taskId: $taskId) {
      success
      error
    }
  }
`;
