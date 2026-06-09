import { useRecordTableOpenHoveredRowHotkey } from '@/object-record/record-table/hooks/useRecordTableOpenHoveredRowHotkey';
import { PageFocusId } from '@/types/PageFocusId';

export const RecordTableBodyOpenHoveredRowKeyboardEffect = () => {
  useRecordTableOpenHoveredRowHotkey({
    focusId: PageFocusId.RecordIndex,
  });

  return null;
};
