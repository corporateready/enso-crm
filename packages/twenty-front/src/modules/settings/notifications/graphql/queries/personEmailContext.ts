import gql from 'graphql-tag';

// Object/launcher email preflight for a chosen deal + contact: resolved sender,
// technical sendability, and advisory consent state.
export const PERSON_EMAIL_CONTEXT = gql`
  query PersonEmailContext($opportunityId: String, $personId: String) {
    personEmailContext(opportunityId: $opportunityId, personId: $personId) {
      from
      canSend
      reason
      hasEmailConsent
      consentNote
    }
  }
`;
