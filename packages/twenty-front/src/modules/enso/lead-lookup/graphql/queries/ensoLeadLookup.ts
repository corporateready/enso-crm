import gql from 'graphql-tag';

// Cross-book contact lookup. Deliberately reads past record visibility, and so
// returns a projection rather than records: identity confirmed through a masked
// phone or email, ownership named, contact details withheld. Every call is
// counted against a daily allowance and audited server-side.
export const ENSO_LEAD_LOOKUP = gql`
  query EnsoLeadLookup($searchTerm: String!) {
    ensoLeadLookup(searchTerm: $searchTerm) {
      isRateLimited
      remainingLookupsToday
      isViewerScoped
      matches {
        personId
        displayName
        matchedOn
        maskedPhone
        maskedEmail
        firstTouchAt
        isMine
        projects {
          projectId
          projectName
          projectCode
          ownerName
          ownerWorkspaceMemberId
          isMine
          firstContactAt
          lastTouchAt
          dealStatus
        }
      }
      dealMatches {
        opportunityId
        dealLabel
        personId
        displayName
        maskedPhone
        maskedEmail
        projectName
        projectCode
        ownerName
        ownerWorkspaceMemberId
        isMine
        dealStatus
        firstContactAt
        lastTouchAt
      }
    }
  }
`;
