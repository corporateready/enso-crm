import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';
import { ENSO_SERVER_CREATED_OBJECT_NAMES } from '@/enso/family-tree/constants/EnsoServerCreatedObjectNames';
import { CoreObjectNameSingular } from 'twenty-shared/types';

const OBJECTS_WITHOUT_MANUAL_RECORD_CREATION: readonly CoreObjectNameSingular[] =
  [CoreObjectNameSingular.WorkflowRun, CoreObjectNameSingular.WorkflowVersion];

export const isRecordTableCreateDisabled = (
  objectMetadataItem: Pick<
    EnrichedObjectMetadataItem,
    'nameSingular' | 'isSystem'
  >,
): boolean => {
  if (objectMetadataItem.isSystem) {
    return true;
  }

  if (
    ENSO_SERVER_CREATED_OBJECT_NAMES.includes(objectMetadataItem.nameSingular)
  ) {
    return true;
  }

  return OBJECTS_WITHOUT_MANUAL_RECORD_CREATION.includes(
    objectMetadataItem.nameSingular as CoreObjectNameSingular,
  );
};
