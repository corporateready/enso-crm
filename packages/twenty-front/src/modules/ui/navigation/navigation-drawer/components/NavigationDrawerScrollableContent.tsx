import { useIsSettingsDrawer } from '@/navigation/hooks/useIsSettingsDrawer';
import { useNavigationDrawerExpanded } from '@/navigation/hooks/useNavigationDrawerExpanded';
import { ScrollWrapper } from '@/ui/utilities/scroll/components/ScrollWrapper';
import { css } from '@linaria/core';
import { styled } from '@linaria/react';
import { type ReactNode } from 'react';
import { useIsMobile } from 'twenty-ui/utilities';
import { themeCssVariables } from 'twenty-ui/theme-constants';

// Reserves the scrollbar's width whether or not the list overflows, matching
// NavigationDrawerFixedContent, so rows above and inside the scroll area share
// a right edge with classic (non-overlay) scrollbars. A class rather than a
// styled prop: ScrollWrapper doesn't forward the style prop Linaria would use.
// Not on the collapsed rail, which is too narrow to give the space up.
const stableScrollbarGutterClassName = css`
  scrollbar-gutter: stable;
`;

// The collapsed rail is 40px wide; a classic 15px scrollbar would leave the
// icons 17px and clip them. Hide it there; wheel and trackpad still scroll.
const hiddenScrollbarClassName = css`
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const StyledItemsContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`;

const StyledScrollableInnerContainer = styled.div<{ isMobile?: boolean }>`
  height: 100%;
  padding-left: ${themeCssVariables.spacing[5]};
  padding-right: ${({ isMobile }) =>
    isMobile ? themeCssVariables.spacing[5] : themeCssVariables.spacing[8]};
`;

export const NavigationDrawerScrollableContent = ({
  children,
}: {
  children: ReactNode;
}) => {
  const isSettingsDrawer = useIsSettingsDrawer();
  const isMobile = useIsMobile();
  const isNavigationDrawerExpanded = useNavigationDrawerExpanded();

  return (
    <ScrollWrapper
      className={
        isNavigationDrawerExpanded
          ? stableScrollbarGutterClassName
          : hiddenScrollbarClassName
      }
      componentInstanceId={`scroll-wrapper-${
        isSettingsDrawer ? 'settings-' : ''
      }navigation-drawer`}
      defaultEnableXScroll={false}
    >
      <StyledItemsContainer>
        {isSettingsDrawer || isMobile ? (
          <StyledScrollableInnerContainer isMobile={isMobile}>
            {children}
          </StyledScrollableInnerContainer>
        ) : (
          <>{children}</>
        )}
      </StyledItemsContainer>
    </ScrollWrapper>
  );
};
