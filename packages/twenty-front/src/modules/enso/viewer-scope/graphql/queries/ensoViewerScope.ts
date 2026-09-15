import gql from 'graphql-tag';

// Whether this viewer only sees the records they own, which objects to leave
// out of their sidebar, and which view each object should open on for their
// role. The lists are served rather than hardcoded here so they have one home
// (the server constant and the per-role configuration).
export const ENSO_VIEWER_SCOPE = gql`
  query EnsoViewerScope {
    ensoViewerScope {
      isRecordScoped
      hiddenNavigationObjectNameSingulars
      defaultViews {
        objectMetadataId
        viewId
      }
      defaultViewsVersion
    }
  }
`;
