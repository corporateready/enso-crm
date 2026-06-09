import { SIDE_PANEL_FOCUS_ID } from '@/side-panel/constants/SidePanelFocusId';
import { useSidePanelMenu } from '@/side-panel/hooks/useSidePanelMenu';
import { useHotkeysOnFocusedElement } from '@/ui/utilities/hotkey/hooks/useHotkeysOnFocusedElement';

// While a record is shown in the side panel, Space hides it back. Mounted only
// by SidePanelRecordPage, so it never interferes with the command-menu search
// or other side-panel pages; enableOnFormTags is off so editing a field with
// the space bar still works.
export const useCloseSidePanelRecordOnSpaceHotkey = () => {
  const { closeSidePanelMenu } = useSidePanelMenu();

  useHotkeysOnFocusedElement({
    keys: ['space'],
    callback: () => {
      closeSidePanelMenu();
    },
    focusId: SIDE_PANEL_FOCUS_ID,
    dependencies: [closeSidePanelMenu],
    options: {
      enableOnFormTags: false,
      enableOnContentEditable: false,
    },
  });
};
