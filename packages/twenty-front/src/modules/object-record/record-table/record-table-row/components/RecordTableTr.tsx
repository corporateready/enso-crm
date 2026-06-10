import { getBasePathToShowPage } from '@/object-metadata/utils/getBasePathToShowPage';
import { useIsRecordReadOnly } from '@/object-record/read-only/hooks/useIsRecordReadOnly';
import { useRecordTableContextOrThrow } from '@/object-record/record-table/contexts/RecordTableContext';
import { RecordTableRowContextProvider } from '@/object-record/record-table/contexts/RecordTableRowContext';
import { RecordTableRowDiv } from '@/object-record/record-table/record-table-row/components/RecordTableRowDiv';
import { isRowSelectedComponentFamilyState } from '@/object-record/record-table/record-table-row/states/isRowSelectedComponentFamilyState';
import { isRecordTableRowActiveComponentFamilyState } from '@/object-record/record-table/states/isRecordTableRowActiveComponentFamilyState';
import { isRecordTableRowFocusActiveComponentState } from '@/object-record/record-table/states/isRecordTableRowFocusActiveComponentState';
import { isRecordTableRowFocusedComponentFamilyState } from '@/object-record/record-table/states/isRecordTableRowFocusedComponentFamilyState';

import { useAtomComponentFamilyStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentFamilyStateValue';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';
import { forwardRef, useRef, type ReactNode } from 'react';
import { AppPath } from 'twenty-shared/types';
import { useNavigateApp } from '~/hooks/useNavigateApp';

// A second primary-button press within this window counts as a double-click.
const DOUBLE_CLICK_THRESHOLD_IN_MS = 300;

type RecordTableTrProps = {
  children: ReactNode;
  recordId: string;
  focusIndex: number;
  isDragging?: boolean;
} & Omit<
  React.ComponentProps<typeof RecordTableRowDiv>,
  'isActive' | 'isNextRowActiveOrFocused' | 'isFocused'
>;

export const RecordTableTr = forwardRef<HTMLDivElement, RecordTableTrProps>(
  ({ children, recordId, focusIndex, isDragging = false, ...props }, ref) => {
    const { objectMetadataItem } = useRecordTableContextOrThrow();

    const navigate = useNavigateApp();

    const lastPrimaryMouseDownTimestampRef = useRef<number | null>(null);

    const openRecordInFullPage = (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      navigate(AppPath.RecordShowPage, {
        objectNameSingular: objectMetadataItem.nameSingular,
        objectRecordId: recordId,
      });
    };

    // A native dblclick never reaches the row: the first click opens the cell
    // editor (or the record), re-rendering the cell so the second click lands
    // on a different element. So detect the double-click ourselves on mousedown
    // capture, which always fires on the row whatever the cell re-renders into.
    // Option+click is handled the same way (open in full page immediately).
    const handleRowMouseDownCapture = (
      event: React.MouseEvent<HTMLDivElement>,
    ) => {
      if (event.button !== 0) {
        return;
      }

      if (event.altKey) {
        lastPrimaryMouseDownTimestampRef.current = null;
        openRecordInFullPage(event);
        return;
      }

      const now = Date.now();
      const lastTimestamp = lastPrimaryMouseDownTimestampRef.current;
      const isDoubleClick =
        lastTimestamp !== null &&
        now - lastTimestamp < DOUBLE_CLICK_THRESHOLD_IN_MS;

      if (isDoubleClick) {
        lastPrimaryMouseDownTimestampRef.current = null;
        openRecordInFullPage(event);
        return;
      }

      lastPrimaryMouseDownTimestampRef.current = now;
    };

    const isRowSelected = useAtomComponentFamilyStateValue(
      isRowSelectedComponentFamilyState,
      recordId,
    );

    const isRecordTableRowActive = useAtomComponentFamilyStateValue(
      isRecordTableRowActiveComponentFamilyState,
      focusIndex,
    );

    const isRecordTableRowFocused = useAtomComponentFamilyStateValue(
      isRecordTableRowFocusedComponentFamilyState,
      focusIndex,
    );

    const isRecordTableRowFocusActive = useAtomComponentStateValue(
      isRecordTableRowFocusActiveComponentState,
    );

    const isRecordReadOnly = useIsRecordReadOnly({
      recordId,
      objectMetadataId: objectMetadataItem.id,
    });

    return (
      <RecordTableRowContextProvider
        value={{
          recordId: recordId,
          rowIndex: focusIndex,
          pathToShowPage:
            getBasePathToShowPage({
              objectNameSingular: objectMetadataItem.nameSingular,
            }) + recordId,
          objectNameSingular: objectMetadataItem.nameSingular,
          isSelected: isRowSelected,
          isRecordReadOnly,
        }}
      >
        <RecordTableRowDiv
          className="table-row"
          isDragging={isDragging}
          ref={ref}
          onMouseDownCapture={handleRowMouseDownCapture}
          data-active={isRecordTableRowActive}
          data-focused={
            isRecordTableRowFocusActive &&
            isRecordTableRowFocused &&
            !isRecordTableRowActive
          }
          // oxlint-disable-next-line react/jsx-props-no-spreading
          {...props}
        >
          {children}
        </RecordTableRowDiv>
      </RecordTableRowContextProvider>
    );
  },
);
