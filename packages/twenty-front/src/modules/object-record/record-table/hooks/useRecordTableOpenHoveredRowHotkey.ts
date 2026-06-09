import { useRecordTableContextOrThrow } from '@/object-record/record-table/contexts/RecordTableContext';
import { recordTableHoverPositionComponentState } from '@/object-record/record-table/states/recordTableHoverPositionComponentState';
import { recordIdByRealIndexComponentState } from '@/object-record/record-table/virtualization/states/recordIdByRealIndexComponentState';
import { useOpenRecordInSidePanel } from '@/side-panel/hooks/useOpenRecordInSidePanel';
import { useHotkeysOnFocusedElement } from '@/ui/utilities/hotkey/hooks/useHotkeysOnFocusedElement';
import { useAtomComponentStateCallbackState } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateCallbackState';
import { useStore } from 'jotai';
import { AppPath } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { useNavigateApp } from '~/hooks/useNavigateApp';

// On the hovered row: Space opens it in the side panel, Option+Space opens it
// in full page. Pressing Space again while the side panel is open hides it
// (handled at the side-panel focus scope, not here — opening the side panel
// takes over the keyboard focus).
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

  const resolveHoveredRecordId = () => {
    const hoverPosition = store.get(hoverPositionCallbackState);

    if (!isDefined(hoverPosition)) {
      return undefined;
    }

    const recordIdByRealIndex = store.get(recordIdByRealIndexCallbackState);

    return recordIdByRealIndex.get(hoverPosition.row);
  };

  const handleSpace = (keyboardEvent: KeyboardEvent) => {
    const recordId = resolveHoveredRecordId();

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

  const handleAltSpace = (keyboardEvent: KeyboardEvent) => {
    const recordId = resolveHoveredRecordId();

    if (!isDefined(recordId)) {
      return;
    }

    keyboardEvent.preventDefault();

    navigate(AppPath.RecordShowPage, {
      objectNameSingular,
      objectRecordId: recordId,
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

  useHotkeysOnFocusedElement({
    keys: ['alt+space'],
    callback: handleAltSpace,
    focusId,
    dependencies: [navigate, objectNameSingular, store],
    options: {
      preventDefault: false,
    },
  });
};
