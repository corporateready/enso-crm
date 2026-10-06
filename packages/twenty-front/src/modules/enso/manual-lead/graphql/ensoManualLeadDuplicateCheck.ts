import gql from 'graphql-tag';

// What adding the lead would do to the contacts already in the CRM — a new
// contact, joining an existing one, or blocked because a colleague works it on
// this project. Reads past record visibility server-side, so it answers with a
// masked match, never a record.
export const ENSO_MANUAL_LEAD_DUPLICATE_CHECK = gql`
  query EnsoManualLeadDuplicateCheck(
    $input: EnsoManualLeadDuplicateCheckInput!
  ) {
    ensoManualLeadDuplicateCheck(input: $input) {
      verdict
      displayName
      maskedPhone
      maskedEmail
      ownerName
      hasOpenDeal
      isRateLimited
    }
  }
`;
