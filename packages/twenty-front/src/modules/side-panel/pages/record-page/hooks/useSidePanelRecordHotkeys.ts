import { SIDE_PANEL_FOCUS_ID } from '@/side-panel/constants/SidePanelFocusId';
import { useSidePanelMenu } from '@/side-panel/hooks/useSidePanelMenu';
import { useHotkeysOnFocusedElement } from '@/ui/utilities/hotkey/hooks/useHotkeysOnFocusedElement';
import { AppPath } from 'twenty-shared/types';
import { useNavigateApp } from '~/hooks/useNavigateApp';

// While a record is shown in the side panel: Space hides it, Option+Space opens
// it in full page. Mounted only by SidePanelRecordPage, so it never interferes
// with the command-menu search or other side-panel pages; enableOnFormTags is
// off so editing a field with the space bar still works.
export const useSidePanelRecordHotkeys = ({
  objectNameSingular,
  objectRecordId,
}: {
  objectNameSingular: string;
  objectRecordId: string;
}) => {
  const { closeSidePanelMenu } = useSidePanelMenu();
  const navigate = useNavigateApp();

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

  useHotkeysOnFocusedElement({
    keys: ['alt+space'],
    callback: () => {
      closeSidePanelMenu();
      navigate(AppPath.RecordShowPage, {
        objectNameSingular,
        objectRecordId,
      });
    },
    focusId: SIDE_PANEL_FOCUS_ID,
    dependencies: [
      closeSidePanelMenu,
      navigate,
      objectNameSingular,
      objectRecordId,
    ],
    options: {
      enableOnFormTags: false,
      enableOnContentEditable: false,
    },
  });
};
