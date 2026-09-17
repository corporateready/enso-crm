import { applyEnsoPersonalColumnWidths } from '@/enso/column-widths/utils/applyEnsoPersonalColumnWidths';
import { type RecordField } from '@/object-record/record-field/types/RecordField';

const recordField = (
  fieldMetadataItemId: string,
  size: number,
): RecordField => ({
  id: `record-field-${fieldMetadataItemId}`,
  fieldMetadataItemId,
  isVisible: true,
  position: 0,
  size,
  aggregateOperation: null,
});

describe('applyEnsoPersonalColumnWidths', () => {
  it('should widen only the columns this person has dragged', () => {
    const recordFields = [
      recordField('field-1', 150),
      recordField('field-2', 150),
    ];

    const result = applyEnsoPersonalColumnWidths({
      recordFields,
      personalColumnWidthByFieldMetadataId: { 'field-1': 260 },
    });

    expect(result.map((field) => field.size)).toEqual([260, 150]);
  });

  it('should return the same fields when nobody has dragged anything', () => {
    const recordFields = [recordField('field-1', 150)];

    expect(
      applyEnsoPersonalColumnWidths({
        recordFields,
        personalColumnWidthByFieldMetadataId: {},
      }),
    ).toBe(recordFields);
  });

  it('should return the same fields when the widths already match', () => {
    const recordFields = [recordField('field-1', 260)];

    expect(
      applyEnsoPersonalColumnWidths({
        recordFields,
        personalColumnWidthByFieldMetadataId: { 'field-1': 260 },
      }),
    ).toBe(recordFields);
  });

  it('should ignore a width for a column the view does not show', () => {
    const recordFields = [recordField('field-1', 150)];

    expect(
      applyEnsoPersonalColumnWidths({
        recordFields,
        personalColumnWidthByFieldMetadataId: { 'field-hidden': 400 },
      }),
    ).toBe(recordFields);
  });
});
