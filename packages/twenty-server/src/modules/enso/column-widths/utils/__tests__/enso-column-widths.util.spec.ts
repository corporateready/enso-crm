import {
  clampEnsoColumnWidth,
  mergeEnsoUserColumnWidth,
  readEnsoUserColumnWidths,
} from 'src/modules/enso/column-widths/utils/enso-column-widths.util';

describe('enso column widths', () => {
  describe('readEnsoUserColumnWidths', () => {
    it('should return an empty map when nothing is stored', () => {
      expect(readEnsoUserColumnWidths(undefined)).toEqual({});
      expect(readEnsoUserColumnWidths(null)).toEqual({});
      expect(readEnsoUserColumnWidths('not an object')).toEqual({});
    });

    it('should keep the widths it can read', () => {
      expect(
        readEnsoUserColumnWidths({ 'view-1': { 'field-1': 260 } }),
      ).toEqual({ 'view-1': { 'field-1': 260 } });
    });

    it('should drop entries that would collapse a column', () => {
      expect(
        readEnsoUserColumnWidths({
          'view-1': { 'field-1': 260, 'field-2': 'wide', 'field-3': 0 },
          'view-2': { 'field-4': Number.NaN },
          'view-3': 'not an object',
        }),
      ).toEqual({ 'view-1': { 'field-1': 260 } });
    });

    it('should clamp a stored width back into range', () => {
      expect(readEnsoUserColumnWidths({ 'view-1': { 'field-1': 9 } })).toEqual({
        'view-1': { 'field-1': 104 },
      });
      expect(
        readEnsoUserColumnWidths({ 'view-1': { 'field-1': 99999 } }),
      ).toEqual({ 'view-1': { 'field-1': 2000 } });
    });
  });

  describe('clampEnsoColumnWidth', () => {
    it('should round to whole pixels', () => {
      expect(clampEnsoColumnWidth(260.6)).toBe(261);
    });
  });

  describe('mergeEnsoUserColumnWidth', () => {
    it('should add a width without touching the other views', () => {
      expect(
        mergeEnsoUserColumnWidth({
          widths: { 'view-1': { 'field-1': 260 } },
          viewId: 'view-2',
          fieldMetadataId: 'field-2',
          size: 300,
        }),
      ).toEqual({
        'view-1': { 'field-1': 260 },
        'view-2': { 'field-2': 300 },
      });
    });

    it('should replace the width of a column already dragged', () => {
      expect(
        mergeEnsoUserColumnWidth({
          widths: { 'view-1': { 'field-1': 260, 'field-2': 150 } },
          viewId: 'view-1',
          fieldMetadataId: 'field-1',
          size: 400,
        }),
      ).toEqual({ 'view-1': { 'field-1': 400, 'field-2': 150 } });
    });

    it('should clear one column when given a null size', () => {
      expect(
        mergeEnsoUserColumnWidth({
          widths: { 'view-1': { 'field-1': 260, 'field-2': 150 } },
          viewId: 'view-1',
          fieldMetadataId: 'field-1',
          size: null,
        }),
      ).toEqual({ 'view-1': { 'field-2': 150 } });
    });

    it('should leave nothing behind when the last override of a view is cleared', () => {
      expect(
        mergeEnsoUserColumnWidth({
          widths: { 'view-1': { 'field-1': 260 } },
          viewId: 'view-1',
          fieldMetadataId: 'field-1',
          size: null,
        }),
      ).toEqual({});
    });

    it('should not mutate the widths it was given', () => {
      const widths = { 'view-1': { 'field-1': 260 } };

      mergeEnsoUserColumnWidth({
        widths,
        viewId: 'view-1',
        fieldMetadataId: 'field-2',
        size: 300,
      });

      expect(widths).toEqual({ 'view-1': { 'field-1': 260 } });
    });
  });
});
