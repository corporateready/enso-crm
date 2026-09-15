import { lastVisitedViewPerObjectMetadataItemState } from '@/navigation/states/lastVisitedViewPerObjectMetadataItemState';
import { objectMetadataItemsSelector } from '@/object-metadata/states/objectMetadataItemsSelector';
import { viewsSelector } from '@/views/states/selectors/viewsSelector';
import { type ViewWithRelations } from '@/views/types/ViewWithRelations';
import { useCallback } from 'react';
import { isDefined } from 'twenty-shared/utils';
import { useStore } from 'jotai';

export const useSetLastVisitedViewForObjectMetadataNamePlural = () => {
  const store = useStore();
  const setLastVisitedViewForObjectMetadataNamePlural = useCallback(
    async ({
      objectNamePlural,
      viewId,
    }: {
      objectNamePlural: string;
      viewId: string;
    }): Promise<boolean> => {
      const views = store.get(viewsSelector.atom);

      const view = views.find((view: ViewWithRelations) => view.id === viewId);

      const objectMetadataItems = store.get(objectMetadataItemsSelector.atom);

      const objectMetadataItem = objectMetadataItems.find(
        (item) => item.namePlural === objectNamePlural,
      );

      // Reports whether this landing was recorded. The view list is re-read
      // here rather than taken from the render that chose `viewId`, so the two
      // can disagree while metadata is refreshing — and a caller that treats a
      // silent bail as success loses whatever it was pairing with the write.
      if (!isDefined(objectMetadataItem) || !isDefined(view)) {
        return false;
      }

      if (view.objectMetadataId !== objectMetadataItem.id) {
        return false;
      }

      const lastVisitedViewPerObjectMetadataItem = store.get(
        lastVisitedViewPerObjectMetadataItemState.atom,
      );

      const lastVisitedViewId =
        lastVisitedViewPerObjectMetadataItem?.[objectMetadataItem?.id];

      if (isDefined(objectMetadataItem) && lastVisitedViewId !== viewId) {
        store.set(lastVisitedViewPerObjectMetadataItemState.atom, {
          ...lastVisitedViewPerObjectMetadataItem,
          [objectMetadataItem.id]: viewId,
        });
      }

      return true;
    },
    [store],
  );

  return {
    setLastVisitedViewForObjectMetadataNamePlural,
  };
};
