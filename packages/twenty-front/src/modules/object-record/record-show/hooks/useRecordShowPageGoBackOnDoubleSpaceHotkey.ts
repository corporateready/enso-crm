import { PageFocusId } from '@/types/PageFocusId';
import { useHotkeysOnFocusedElement } from '@/ui/utilities/hotkey/hooks/useHotkeysOnFocusedElement';
import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';

// A second Space press within this window counts as a double press.
const DOUBLE_PRESS_THRESHOLD_IN_MS = 300;

// On the full record page, pressing Space twice goes back to where you came
// from. A single Space is left untouched so the page can still scroll.
export const useRecordShowPageGoBackOnDoubleSpaceHotkey = () => {
  const navigate = useNavigate();

  const lastSpacePressTimestampRef = useRef<number | null>(null);

  const handleSpace = (keyboardEvent: KeyboardEvent) => {
    const now = Date.now();
    const lastTimestamp = lastSpacePressTimestampRef.current;

    const isDoublePress =
      lastTimestamp !== null &&
      now - lastTimestamp < DOUBLE_PRESS_THRESHOLD_IN_MS;

    if (isDoublePress) {
      lastSpacePressTimestampRef.current = null;
      keyboardEvent.preventDefault();
      navigate(-1);
      return;
    }

    lastSpacePressTimestampRef.current = now;
  };

  useHotkeysOnFocusedElement({
    keys: ['space'],
    callback: handleSpace,
    focusId: PageFocusId.RecordShowPage,
    dependencies: [navigate],
    options: {
      preventDefault: false,
    },
  });
};
