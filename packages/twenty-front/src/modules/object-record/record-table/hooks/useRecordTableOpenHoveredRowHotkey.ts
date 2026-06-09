import { useRecordTableContextOrThrow } from '@/object-record/record-table/contexts/RecordTableContext';
import { recordTableHoverPositionComponentState } from '@/object-record/record-table/states/recordTableHoverPositionComponentState';
import { recordIdByRealIndexComponentState } from '@/object-record/record-table/virtualization/states/recordIdByRealIndexComponentState';
import { useOpenRecordInSidePanel } from '@/side-panel/hooks/useOpenRecordInSidePanel';
import { useHotkeysOnFocusedElement } from '@/ui/utilities/hotkey/hooks/useHotkeysOnFocusedElement';
import { useAtomComponentStateCallbackState } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateCallbackState';
import { useStore } from 'jotai';
import { isDefined } from 'twenty-shared/utils';

// Space on the hovered row opens it in the side panel. Pressing Space again
// while the side panel is open hides it (handled at the side-panel focus scope,
// not here — opening the side panel takes over the keyboard focus).
export const useRecordTableOpenHoveredRowHotkey = ({
  focusId,
}: {
  focusId: string;
}) => {
  const { recordTableId, objectNameSingular } = useRecordTableContextOrThrow();

  const { openRecordInSidePanel } = useOpenRecordInSidePanel();
  const store = useStore();

  const hoverPositionCallbackState = useAtomComponentStateCallbackState(
    recordTableHoverPositionComponentState,
    recordTableId,
  );

  const recordIdByRealIndexCallbackState = useAtomComponentStateCallbackState(
    recordIdByRealIndexComponentState,
    recordTableId,
  );

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
    dependencies: [openRecordInSidePanel, objectNameSingular, store],
    options: {
      preventDefault: false,
    },
  });
};
