import gql from 'graphql-tag';

// The read-only expansion of a lookup match. Returns a projection, never a
// record: ownership, warmth and origin, with the contact's identity still
// masked and nothing editable.
export const ENSO_LEAD_PROFILE = gql`
  query EnsoLeadProfile($personId: String, $opportunityId: String) {
    ensoLeadProfile(personId: $personId, opportunityId: $opportunityId) {
      isFound
      isViewerScoped
      personId
      displayName
      maskedPhone
      maskedEmail
      firstTouchAt
      isMine
      projects {
        projectId
        projectName
        projectCode
        ownerName
        ownerEmail
        ownerWorkspaceMemberId
        isMine
        firstContactAt
        lastTouchAt
        dealLabel
        dealStage
        dealStatus
        dealSource
        trafficType
        utmSource
        utmCampaign
        reengagementCount
      }
      activity {
        inboundCount
        outboundCount
        lastInboundAt
        lastOutboundAt
      }
    }
  }
`;
