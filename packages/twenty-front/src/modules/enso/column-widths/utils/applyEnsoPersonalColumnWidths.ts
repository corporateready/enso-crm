import { type RecordField } from '@/object-record/record-field/types/RecordField';
import { isDefined } from 'twenty-shared/utils';

// Lays this person's own widths over the ones the view carries. Returns the
// array it was given when nothing changes, so the caller can skip the write and
// the effect that calls it cannot loop.
export const applyEnsoPersonalColumnWidths = ({
  recordFields,
  personalColumnWidthByFieldMetadataId,
}: {
  recordFields: RecordField[];
  personalColumnWidthByFieldMetadataId: Record<string, number>;
}): RecordField[] => {
  let hasChanged = false;

  const nextRecordFields = recordFields.map((recordField) => {
    const personalWidth =
      personalColumnWidthByFieldMetadataId[recordField.fieldMetadataItemId];

    if (!isDefined(personalWidth) || personalWidth === recordField.size) {
      return recordField;
    }

    hasChanged = true;

    return { ...recordField, size: personalWidth };
  });

  return hasChanged ? nextRecordFields : recordFields;
};
