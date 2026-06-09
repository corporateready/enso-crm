import { useRecordTableContextOrThrow } from '@/object-record/record-table/contexts/RecordTableContext';
import { recordTableHoverPositionComponentState } from '@/object-record/record-table/states/recordTableHoverPositionComponentState';
import { recordIdByRealIndexComponentState } from '@/object-record/record-table/virtualization/states/recordIdByRealIndexComponentState';
import { useOpenRecordInSidePanel } from '@/side-panel/hooks/useOpenRecordInSidePanel';
import { useHotkeysOnFocusedElement } from '@/ui/utilities/hotkey/hooks/useHotkeysOnFocusedElement';
import { useAtomComponentStateCallbackState } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateCallbackState';
import { useStore } from 'jotai';
import { useRef } from 'react';
import { AppPath } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { useNavigateApp } from '~/hooks/useNavigateApp';

// A second Space press within this window opens the record in full page.
const DOUBLE_PRESS_THRESHOLD_IN_MS = 300;

// Space on the hovered row opens it in the side panel; a quick second
// Space on the same row opens it in full page.
export const useRecordTableOpenHoveredRowHotkey = ({
  focusId,
}: {
  focusId: string;
}) => {
  const { recordTableId, objectNameSingular } = useRecordTableContextOrThrow();

  const { openRecordInSidePanel } = useOpenRecordInSidePanel();
  const navigate = useNavigateApp();
  const store = useStore();

  const hoverPositionCallbackState = useAtomComponentStateCallbackState(
    recordTableHoverPositionComponentState,
    recordTableId,
  );

  const recordIdByRealIndexCallbackState = useAtomComponentStateCallbackState(
    recordIdByRealIndexComponentState,
    recordTableId,
  );

  const lastSpacePressRef = useRef<{
    recordId: string;
    timestamp: number;
  } | null>(null);

  const handleSpace = (keyboardEvent: KeyboardEvent) => {
    const hoverPosition = store.get(hoverPositionCallbackState);

    if (!isDefined(hoverPosition)) {
      return;
    }

    const recordIdByRealIndex = store.get(recordIdByRealIndexCallbackState);
    const recordId = recordIdByRealIndex.get(hoverPosition.row);

    if (!isDefined(recordId)) {
      return;
    }

    // Only swallow the spacebar (which would otherwise scroll the page) when
    // we actually have a hovered record to open.
    keyboardEvent.preventDefault();

    const now = Date.now();
    const lastSpacePress = lastSpacePressRef.current;

    const isDoublePress =
      isDefined(lastSpacePress) &&
      lastSpacePress.recordId === recordId &&
      now - lastSpacePress.timestamp < DOUBLE_PRESS_THRESHOLD_IN_MS;

    if (isDoublePress) {
      lastSpacePressRef.current = null;
      navigate(AppPath.RecordShowPage, {
        objectNameSingular,
        objectRecordId: recordId,
      });
      return;
    }

    lastSpacePressRef.current = { recordId, timestamp: now };
    openRecordInSidePanel({
      recordId,
      objectNameSingular,
      isNewRecord: false,
    });
  };

  useHotkeysOnFocusedElement({
    keys: ['space'],
    callback: handleSpace,
    focusId,
    dependencies: [openRecordInSidePanel, navigate, objectNameSingular, store],
    options: {
      preventDefault: false,
    },
  });
};
