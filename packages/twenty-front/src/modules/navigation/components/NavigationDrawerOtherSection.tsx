import { useLingui } from '@lingui/react/macro';
import { SettingsPath } from 'twenty-shared/types';
import { IconHelpCircle, IconSettings } from 'twenty-ui/display';
import { AnimatedExpandableContainer } from 'twenty-ui/layout';

import { currentWorkspaceMemberState } from '@/auth/states/currentWorkspaceMemberState';
import { useEnsoViewerScope } from '@/enso/viewer-scope/hooks/useEnsoViewerScope';
import { getDocumentationUrl } from '@/support/utils/getDocumentationUrl';
import { SIDEBAR_UTILITY_ICON_COLOR } from '@/navigation/constants/SidebarUtilityIconColor';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';

import { NavigationDrawerAnimatedCollapseWrapper } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerAnimatedCollapseWrapper';
import { NavigationDrawerItem } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerItem';
import { NavigationDrawerSection } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerSection';
import { NavigationDrawerSectionTitle } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerSectionTitle';
import { useNavigationSection } from '@/ui/navigation/navigation-drawer/hooks/useNavigationSection';
import { isNavigationSectionOpenFamilyState } from '@/ui/navigation/navigation-drawer/states/isNavigationSectionOpenFamilyState';
import { useAtomFamilyStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomFamilyStateValue';
import { useNavigateSettings } from '~/hooks/useNavigateSettings';

export const NavigationDrawerOtherSection = () => {
  const { t } = useLingui();
  const navigateSettings = useNavigateSettings();
  const currentWorkspaceMember = useAtomStateValue(currentWorkspaceMemberState);
  const { isRecordScoped, isEnsoViewerScopeLoading } = useEnsoViewerScope();

  // The link goes to Twenty's own product docs, which are noise for sales
  // managers. Held back while the scope loads so it never flashes for them.
  const isDocumentationLinkVisible =
    !isRecordScoped && !isEnsoViewerScopeLoading;

  const { toggleNavigationSection } = useNavigationSection('Other');
  const isNavigationSectionOpen = useAtomFamilyStateValue(
    isNavigationSectionOpenFamilyState,
    'Other',
  );

  const handleSettingsClick = () => {
    navigateSettings(SettingsPath.ProfilePage);
  };

  return (
    <NavigationDrawerSection>
      <NavigationDrawerAnimatedCollapseWrapper>
        <NavigationDrawerSectionTitle
          label={t`Other`}
          onClick={toggleNavigationSection}
          isOpen={isNavigationSectionOpen}
        />
      </NavigationDrawerAnimatedCollapseWrapper>
      <AnimatedExpandableContainer
        isExpanded={isNavigationSectionOpen}
        dimension="height"
        mode="fit-content"
        containAnimation
        initial={false}
      >
        <NavigationDrawerItem
          label={t`Settings`}
          Icon={IconSettings}
          iconColor={SIDEBAR_UTILITY_ICON_COLOR}
          onClick={handleSettingsClick}
        />
        {isDocumentationLinkVisible && (
          <NavigationDrawerItem
            label={t`Documentation`}
            to={getDocumentationUrl({
              locale: currentWorkspaceMember?.locale,
            })}
            Icon={IconHelpCircle}
            iconColor={SIDEBAR_UTILITY_ICON_COLOR}
          />
        )}
      </AnimatedExpandableContainer>
    </NavigationDrawerSection>
  );
};
