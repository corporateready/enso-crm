import gql from 'graphql-tag';

// Preflight for the SMS compose modal: the alias determined from the deal's
// project, plus whether the SMS may be sent (phone, project alias, consent).
export const TASK_SMS_CONTEXT = gql`
  query TaskSmsContext($taskId: String!) {
    taskSmsContext(taskId: $taskId) {
      alias
      canSend
      reason
    }
  }
`;
