import { useToggleNavigationDrawer } from '@/ui/navigation/navigation-drawer/hooks/useToggleNavigationDrawer';
import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import {
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarRightCollapse,
} from 'twenty-ui/display';
import { LightIconButton } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { getOsControlSymbol } from 'twenty-ui/utilities';

const StyledCollapseButton = styled.div`
  align-items: center;
  border-radius: ${themeCssVariables.border.radius.md};
  color: ${themeCssVariables.font.color.light};
  cursor: pointer;
  display: flex;
  justify-content: center;
  user-select: none;
`;

type NavigationDrawerCollapseButtonProps = {
  className?: string;
  direction?: 'left' | 'right';
};

export const NavigationDrawerCollapseButton = ({
  className,
  direction = 'left',
}: NavigationDrawerCollapseButtonProps) => {
  const { t } = useLingui();
  const { toggleNavigationDrawer } = useToggleNavigationDrawer();
  const label = direction === 'left' ? t`Collapse sidebar` : t`Expand sidebar`;

  return (
    <StyledCollapseButton
      className={className}
      onClick={toggleNavigationDrawer}
    >
      <LightIconButton
        Icon={
          direction === 'left'
            ? IconLayoutSidebarLeftCollapse
            : IconLayoutSidebarRightCollapse
        }
        accent="secondary"
        size="small"
        title={`${label} (${getOsControlSymbol()}B)`}
        aria-label={label}
      />
    </StyledCollapseButton>
  );
};
