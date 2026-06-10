import { isNavigationModifierPressed } from '@ui/utilities/navigation/isNavigationModifierPressed';
import { type TriggerEventType } from '@ui/utilities/navigation/types/trigger-event.type';
import { type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { isDefined } from 'twenty-shared/utils';

type UseMouseDownNavigationProps = {
  to?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  disabled?: boolean;
  onBeforeNavigation?: () => void;
  triggerEvent?: TriggerEventType;
  stopPropagation?: boolean;
};

export const useMouseDownNavigation = ({
  to,
  onClick,
  disabled = false,
  onBeforeNavigation,
  triggerEvent = 'MOUSE_DOWN',
}: UseMouseDownNavigationProps) => {
  const navigate = useNavigate();

  const handleClick = (event: MouseEvent<HTMLElement>) => {
    if (disabled) return;

    // For modifier keys, let the default browser behavior handle it
    if (isNavigationModifierPressed(event)) {
      // Exception: Option/Alt+click on an <a href> is interpreted by the
      // browser (macOS) as "download the link target", which is never useful
      // for an in-app record link. Navigate to the target instead. Cmd/Ctrl/
      // Shift keep their native behavior (open in a new tab/window).
      const isOnlyAltPressed =
        event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        event.button === 0;

      if (isOnlyAltPressed && isDefined(to)) {
        event.preventDefault();
        onBeforeNavigation?.();
        navigate(to);
        return;
      }

      onBeforeNavigation?.();
      if (isDefined(onClick) && !isDefined(to)) {
        onClick(event);
      }
      // Don't prevent default for modifier keys to allow browser navigation
      return;
    }

    if (triggerEvent === 'CLICK') {
      onBeforeNavigation?.();
      if (isDefined(onClick)) {
        onClick(event);
      } else if (isDefined(to)) {
        navigate(to);
      }
    }

    // For regular clicks, prevent default to avoid double navigation
    event.preventDefault();
  };

  const handleMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (disabled || triggerEvent === 'CLICK') return;

    if (isNavigationModifierPressed(event)) {
      return;
    }

    onBeforeNavigation?.();

    if (isDefined(onClick)) {
      onClick(event);
    } else if (isDefined(to)) {
      navigate(to);
    }
  };

  return {
    onClick: handleClick,
    onMouseDown: handleMouseDown,
  };
};
