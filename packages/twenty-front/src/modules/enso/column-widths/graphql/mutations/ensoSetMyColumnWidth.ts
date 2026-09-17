import gql from 'graphql-tag';

// Remembers how wide THIS person made one column on one view. Their own
// setting, so it needs no permission beyond being signed in — which is the
// point: a member who cannot edit a shared view can still keep their layout.
// A null size clears the override and hands the column back to the view.
export const ENSO_SET_MY_COLUMN_WIDTH = gql`
  mutation EnsoSetMyColumnWidth(
    $viewId: String!
    $fieldMetadataId: String!
    $size: Int
  ) {
    ensoSetMyColumnWidth(
      viewId: $viewId
      fieldMetadataId: $fieldMetadataId
      size: $size
    ) {
      viewId
      fieldMetadataId
      size
    }
  }
`;
