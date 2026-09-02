import gql from 'graphql-tag';

// Click-to-call through the Moldcell PBX. Two-legged by design: the PBX rings
// the MANAGER's own phone first, then bridges the contact — there is no
// browser-audio option, so this doubles as "request a callback". Returns the
// outboundActivity it logged the attempt against, which the widget then stamps
// the outcome onto instead of creating a second row for the same call.
export const CALL_VIA_PBX = gql`
  mutation CallViaPbx(
    $personId: String
    $opportunityId: String
    $taskId: String
  ) {
    callViaPbx(
      personId: $personId
      opportunityId: $opportunityId
      taskId: $taskId
    ) {
      success
      error
      activityId
    }
  }
`;
