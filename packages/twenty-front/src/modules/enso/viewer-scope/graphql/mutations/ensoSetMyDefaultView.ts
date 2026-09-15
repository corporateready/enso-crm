import gql from 'graphql-tag';

// Sets (or, with a null viewId, clears) this person's own landing view for one
// object. Their own setting, so it needs no permission beyond being signed in.
export const ENSO_SET_MY_DEFAULT_VIEW = gql`
  mutation EnsoSetMyDefaultView($objectMetadataId: String!, $viewId: String) {
    ensoSetMyDefaultView(
      objectMetadataId: $objectMetadataId
      viewId: $viewId
    ) {
      objectMetadataId
      viewId
    }
  }
`;
