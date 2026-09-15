import { useMutation } from '@apollo/client/react';

import { ENSO_SET_MY_DEFAULT_VIEW } from '@/enso/viewer-scope/graphql/mutations/ensoSetMyDefaultView';
import { ENSO_VIEWER_SCOPE } from '@/enso/viewer-scope/graphql/queries/ensoViewerScope';
import { useCallback } from 'react';

export const useSetMyDefaultView = () => {
  // The viewer scope is cached for the session, so it has to be refetched here
  // or the picker would keep showing the previous default until a reload.
  const [mutate] = useMutation(ENSO_SET_MY_DEFAULT_VIEW, {
    refetchQueries: [{ query: ENSO_VIEWER_SCOPE }],
    awaitRefetchQueries: true,
  });

  const setMyDefaultView = useCallback(
    ({
      objectMetadataId,
      viewId,
    }: {
      objectMetadataId: string;
      // Null clears it, handing the object back to the role default.
      viewId: string | null;
    }) => mutate({ variables: { objectMetadataId, viewId } }),
    [mutate],
  );

  return { setMyDefaultView };
};
