import { isDefined } from 'twenty-shared/utils';

import {
  ENSO_COLUMN_WIDTH_MAX,
  ENSO_COLUMN_WIDTH_MIN,
} from 'src/modules/enso/column-widths/constants/enso-column-widths.constants';

// viewId -> fieldMetadataId -> width in px.
export type EnsoUserColumnWidths = Record<string, Record<string, number>>;

export const clampEnsoColumnWidth = (size: number): number =>
  Math.min(
    Math.max(Math.round(size), ENSO_COLUMN_WIDTH_MIN),
    ENSO_COLUMN_WIDTH_MAX,
  );

// The stored value is free-form JSON, so it is read defensively: anything that
// is not a positive number is dropped rather than handed to the table, where a
// NaN width would collapse a column.
export const readEnsoUserColumnWidths = (
  stored: unknown,
): EnsoUserColumnWidths => {
  if (!isDefined(stored) || typeof stored !== 'object') {
    return {};
  }

  const widths: EnsoUserColumnWidths = {};

  for (const [viewId, viewWidths] of Object.entries(stored)) {
    if (!isDefined(viewWidths) || typeof viewWidths !== 'object') {
      continue;
    }

    const readViewWidths: Record<string, number> = {};

    for (const [fieldMetadataId, size] of Object.entries(viewWidths)) {
      if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
        continue;
      }

      readViewWidths[fieldMetadataId] = clampEnsoColumnWidth(size);
    }

    if (Object.keys(readViewWidths).length > 0) {
      widths[viewId] = readViewWidths;
    }
  }

  return widths;
};

// A null size clears the override and hands the column back to the view's own
// width. The view's entry is dropped once its last override goes, so clearing
// leaves nothing behind.
export const mergeEnsoUserColumnWidth = ({
  widths,
  viewId,
  fieldMetadataId,
  size,
}: {
  widths: EnsoUserColumnWidths;
  viewId: string;
  fieldMetadataId: string;
  size: number | null;
}): EnsoUserColumnWidths => {
  const nextViewWidths = { ...(widths[viewId] ?? {}) };

  if (isDefined(size)) {
    nextViewWidths[fieldMetadataId] = clampEnsoColumnWidth(size);
  } else {
    delete nextViewWidths[fieldMetadataId];
  }

  const nextWidths = { ...widths };

  if (Object.keys(nextViewWidths).length > 0) {
    nextWidths[viewId] = nextViewWidths;
  } else {
    delete nextWidths[viewId];
  }

  return nextWidths;
};
