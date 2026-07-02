import gql from 'graphql-tag';

// Preflight for the email compose modal: the resolved sender mailbox, whether
// the email may TECHNICALLY be sent, and the ADVISORY consent state (which
// informs the manager but never blocks — unlike SMS).
export const TASK_EMAIL_CONTEXT = gql`
  query TaskEmailContext($taskId: String!) {
    taskEmailContext(taskId: $taskId) {
      from
      canSend
      reason
      hasEmailConsent
      consentNote
    }
  }
`;
