import { useLingui } from '@lingui/react/macro';
import { IconSearch } from 'twenty-ui/display';
import { getOsControlSymbol, useIsMobile } from 'twenty-ui/utilities';

import { SIDEBAR_UTILITY_ICON_COLOR } from '@/navigation/constants/SidebarUtilityIconColor';
import { useOpenRecordsSearchPageInSidePanel } from '@/side-panel/hooks/useOpenRecordsSearchPageInSidePanel';
import { NavigationDrawerItem } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerItem';

// A full sidebar row rather than an icon squeezed beside the workspace name,
// so search is findable and lines up with everything below it. Mobile has its
// own search in the bottom bar.
export const MainNavigationDrawerSearchItem = () => {
  const { t } = useLingui();
  const isMobile = useIsMobile();
  const { openRecordsSearchPage } = useOpenRecordsSearchPageInSidePanel();

  if (isMobile) {
    return null;
  }

  return (
    <NavigationDrawerItem
      label={t`Search`}
      Icon={IconSearch}
      iconColor={SIDEBAR_UTILITY_ICON_COLOR}
      onClick={openRecordsSearchPage}
      modifier={{ keyboard: [getOsControlSymbol(), 'K'] }}
    />
  );
};
