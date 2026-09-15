import { appliedRoleDefaultViewVersionPerObjectMetadataItemState } from '@/navigation/states/appliedRoleDefaultViewVersionPerObjectMetadataItemState';
import { useCallback } from 'react';
import { useStore } from 'jotai';

export const useMarkRoleDefaultViewApplied = () => {
  const store = useStore();

  const markRoleDefaultViewApplied = useCallback(
    ({
      objectMetadataItemId,
      version,
    }: {
      objectMetadataItemId: string;
      version: string;
    }) => {
      const appliedVersions = store.get(
        appliedRoleDefaultViewVersionPerObjectMetadataItemState.atom,
      );

      if (appliedVersions?.[objectMetadataItemId] === version) {
        return;
      }

      store.set(appliedRoleDefaultViewVersionPerObjectMetadataItemState.atom, {
        ...appliedVersions,
        [objectMetadataItemId]: version,
      });
    },
    [store],
  );

  return { markRoleDefaultViewApplied };
};
