import { type ReactNode } from 'react';

import { useIsSettingsDrawer } from '@/navigation/hooks/useIsSettingsDrawer';
import { useNavigationDrawerExpanded } from '@/navigation/hooks/useNavigationDrawerExpanded';
import { NavigationDrawerSection } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerSection';
import { styled } from '@linaria/react';
import { useIsMobile } from 'twenty-ui/utilities';
import { themeCssVariables } from 'twenty-ui/theme-constants';

// Same scrollbar gutter as NavigationDrawerScrollableContent (a gutter is
// only reserved on a scroll container, hence overflow: hidden), so this
// content lines up with the scrolling list below it. flex-shrink: 0 because
// the drawer's column squeezed this box below its content; that overflow used
// to spill out visibly and would now be clipped.
const StyledFixedContainer = styled.div<{
  isSettings?: boolean;
  isMobile?: boolean;
  isNavigationDrawerExpanded: boolean;
}>`
  flex-shrink: 0;
  overflow: ${({ isNavigationDrawerExpanded }) =>
    isNavigationDrawerExpanded ? 'hidden' : 'visible'};
  padding-left: ${({ isSettings, isMobile }) =>
    isSettings || isMobile ? themeCssVariables.spacing[5] : '0'};
  padding-right: ${({ isSettings, isMobile }) =>
    isMobile
      ? themeCssVariables.spacing[5]
      : isSettings
        ? themeCssVariables.spacing[8]
        : '0'};
  scrollbar-gutter: ${({ isNavigationDrawerExpanded }) =>
    isNavigationDrawerExpanded ? 'stable' : 'auto'};
`;
export const NavigationDrawerFixedContent = ({
  children,
}: {
  children: ReactNode;
}) => {
  const isSettingsDrawer = useIsSettingsDrawer();
  const isMobile = useIsMobile();
  const isNavigationDrawerExpanded = useNavigationDrawerExpanded();

  return (
    <StyledFixedContainer
      isSettings={isSettingsDrawer}
      isMobile={isMobile}
      isNavigationDrawerExpanded={isNavigationDrawerExpanded}
    >
      <NavigationDrawerSection>{children}</NavigationDrawerSection>
    </StyledFixedContainer>
  );
};
