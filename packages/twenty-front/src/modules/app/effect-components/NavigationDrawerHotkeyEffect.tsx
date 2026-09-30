import { useToggleNavigationDrawer } from '@/ui/navigation/navigation-drawer/hooks/useToggleNavigationDrawer';
import { useGlobalHotkeys } from '@/ui/utilities/hotkey/hooks/useGlobalHotkeys';
import { useIsMobile } from 'twenty-ui/utilities';

export const NavigationDrawerHotkeyEffect = () => {
  const isMobile = useIsMobile();
  const { toggleNavigationDrawer } = useToggleNavigationDrawer();

  useGlobalHotkeys({
    keys: ['ctrl+b', 'meta+b'],
    callback: () => {
      // On mobile the drawer is an overlay opened by touch, not a column.
      if (!isMobile) {
        toggleNavigationDrawer();
      }
    },
    containsModifier: true,
    dependencies: [isMobile, toggleNavigationDrawer],
    // Cmd+B is bold in the note editor and in text fields; leave it to them.
    options: {
      enableOnContentEditable: false,
      enableOnFormTags: false,
    },
  });

  return null;
};
