import { objectMetadataItemsBySingularNameSelector } from '@/object-metadata/states/objectMetadataItemsBySingularNameSelector';
import { useAtomFamilySelectorValue } from '@/ui/utilities/state/jotai/hooks/useAtomFamilySelectorValue';

export const useDoObjectMetadataItemsExist = (
  objectNameSingulars: string[],
) => {
  const objectMetadataItems = useAtomFamilySelectorValue(
    objectMetadataItemsBySingularNameSelector,
    objectNameSingulars,
  );

  // The selector flatMaps a name it cannot resolve to [] rather than to
  // [undefined], so an `every(isDefined)` here was vacuously true for every
  // missing item — including when the metadata has not loaded at all and the
  // result is empty. Count what came back instead.
  return objectMetadataItems.length === objectNameSingulars.length;
};
