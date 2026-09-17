import { useQuery } from '@apollo/client/react';

import { ENSO_VIEWER_SCOPE } from '@/enso/viewer-scope/graphql/queries/ensoViewerScope';
import { type EnsoPersonalColumnWidth } from '@/enso/column-widths/types/EnsoPersonalColumnWidth';

type EnsoViewerScopeData = {
  ensoViewerScope: {
    isRecordScoped: boolean;
    hiddenNavigationObjectNameSingulars: string[];
    defaultViews: { objectMetadataId: string; viewId: string }[];
    defaultViewsVersion: string | null;
    personalDefaultViews: { objectMetadataId: string; viewId: string }[];
    personalColumnWidths: EnsoPersonalColumnWidth[];
  };
};

const EMPTY_HIDDEN_OBJECTS: string[] = [];
const EMPTY_COLUMN_WIDTHS: EnsoPersonalColumnWidth[] = [];
const EMPTY_DEFAULT_VIEWS: { objectMetadataId: string; viewId: string }[] = [];

// Cached for the session: a viewer's role does not change under them, and the
// sidebar renders on every page.
export const useEnsoViewerScope = () => {
  const { data, loading } = useQuery<EnsoViewerScopeData>(ENSO_VIEWER_SCOPE, {
    fetchPolicy: 'cache-first',
  });

  return {
    isRecordScoped: data?.ensoViewerScope.isRecordScoped ?? false,
    hiddenNavigationObjectNameSingulars:
      data?.ensoViewerScope.hiddenNavigationObjectNameSingulars ??
      EMPTY_HIDDEN_OBJECTS,
    // objectMetadataId -> viewId for this viewer's role. Consulted by the view
    // resolver ahead of the workspace INDEX view.
    roleDefaultViewIdByObjectMetadataId: Object.fromEntries(
      (data?.ensoViewerScope.defaultViews ?? EMPTY_DEFAULT_VIEWS).map(
        (defaultView) => [defaultView.objectMetadataId, defaultView.viewId],
      ),
    ),
    roleDefaultViewsVersion: data?.ensoViewerScope.defaultViewsVersion ?? null,
    // This viewer's own choice, which out-ranks their role's.
    personalDefaultViewIdByObjectMetadataId: Object.fromEntries(
      (data?.ensoViewerScope.personalDefaultViews ?? EMPTY_DEFAULT_VIEWS).map(
        (defaultView) => [defaultView.objectMetadataId, defaultView.viewId],
      ),
    ),
    // Every column this viewer has dragged for themselves, across all views.
    // Indexed per view by useEnsoPersonalColumnWidths.
    personalColumnWidths:
      data?.ensoViewerScope.personalColumnWidths ?? EMPTY_COLUMN_WIDTHS,
    // Whoever decides which view to open MUST wait for this. Answering before
    // it lands means falling through to the INDEX view and, because landing on
    // a view records it as last-visited, pinning that wrong answer for good.
    // Errors settle it too: a viewer-scope failure should degrade to the plain
    // workspace defaults, not hang the app.
    isEnsoViewerScopeLoading: loading,
  };
};
