import { isNavigationDrawerExpandedState } from '@/ui/navigation/states/isNavigationDrawerExpanded';
import { navigationDrawerActiveTabState } from '@/ui/navigation/states/navigationDrawerActiveTabState';
import { NAVIGATION_DRAWER_TABS } from '@/ui/navigation/states/navigationDrawerTabs';
import { useStore } from 'jotai';
import { useCallback } from 'react';

// Shared by the collapse button and the Cmd+B shortcut so both behave the same.
export const useToggleNavigationDrawer = () => {
  const store = useStore();

  const toggleNavigationDrawer = useCallback(() => {
    const isNavigationDrawerExpanded = store.get(
      isNavigationDrawerExpandedState.atom,
    );

    if (isNavigationDrawerExpanded) {
      store.set(
        navigationDrawerActiveTabState.atom,
        NAVIGATION_DRAWER_TABS.NAVIGATION_MENU,
      );
    }

    store.set(
      isNavigationDrawerExpandedState.atom,
      !isNavigationDrawerExpanded,
    );
  }, [store]);

  return { toggleNavigationDrawer };
};
