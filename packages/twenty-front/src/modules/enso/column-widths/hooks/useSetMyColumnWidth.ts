import { useMutation } from '@apollo/client/react';
import { useCallback } from 'react';

import { ENSO_SET_MY_COLUMN_WIDTH } from '@/enso/column-widths/graphql/mutations/ensoSetMyColumnWidth';
import { ENSO_VIEWER_SCOPE } from '@/enso/viewer-scope/graphql/queries/ensoViewerScope';
import { type EnsoPersonalColumnWidth } from '@/enso/column-widths/types/EnsoPersonalColumnWidth';
import { isDefined } from 'twenty-shared/utils';

type EnsoSetMyColumnWidthData = {
  ensoSetMyColumnWidth: EnsoPersonalColumnWidth[];
};

export const useSetMyColumnWidth = () => {
  // The viewer scope is cached for the session, so the new widths are written
  // straight into that cache rather than refetched: a refetch on every drag
  // would be a round trip the person is already waiting on nothing for.
  const [mutate] = useMutation<EnsoSetMyColumnWidthData>(
    ENSO_SET_MY_COLUMN_WIDTH,
    {
      update: (cache, { data }) => {
        const personalColumnWidths = data?.ensoSetMyColumnWidth;

        if (!isDefined(personalColumnWidths)) {
          return;
        }

        const cached = cache.readQuery<{
          ensoViewerScope: Record<string, unknown>;
        }>({ query: ENSO_VIEWER_SCOPE });

        if (!isDefined(cached)) {
          return;
        }

        cache.writeQuery({
          query: ENSO_VIEWER_SCOPE,
          data: {
            ensoViewerScope: {
              ...cached.ensoViewerScope,
              personalColumnWidths,
            },
          },
        });
      },
    },
  );

  const setMyColumnWidth = useCallback(
    ({
      viewId,
      fieldMetadataId,
      size,
    }: {
      viewId: string;
      fieldMetadataId: string;
      // Null clears it, handing the column back to the view's own width.
      size: number | null;
    }) => mutate({ variables: { viewId, fieldMetadataId, size } }),
    [mutate],
  );

  return { setMyColumnWidth };
};
