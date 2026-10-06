import gql from 'graphql-tag';

export const ENSO_CREATE_MANUAL_LEAD = gql`
  mutation EnsoCreateManualLead($input: EnsoCreateManualLeadInput!) {
    ensoCreateManualLead(input: $input) {
      success
      error
      personId
      opportunityId
      activityId
      isNewDeal
      isNewPerson
    }
  }
`;
