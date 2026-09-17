import { useMemo } from 'react';

import { useEnsoViewerScope } from '@/enso/viewer-scope/hooks/useEnsoViewerScope';
import { isDefined } from 'twenty-shared/utils';

const EMPTY_WIDTHS: Record<string, number> = {};

// This person's own column widths on one view, as fieldMetadataId -> px.
// A field missing from the map has never been dragged and keeps the view's
// own width.
export const useEnsoPersonalColumnWidths = (viewId: string | undefined) => {
  const { personalColumnWidths } = useEnsoViewerScope();

  const personalColumnWidthByFieldMetadataId = useMemo(() => {
    if (!isDefined(viewId)) {
      return EMPTY_WIDTHS;
    }

    return Object.fromEntries(
      personalColumnWidths
        .filter((columnWidth) => columnWidth.viewId === viewId)
        .map((columnWidth) => [columnWidth.fieldMetadataId, columnWidth.size]),
    );
  }, [personalColumnWidths, viewId]);

  return { personalColumnWidthByFieldMetadataId };
};
