import { PageFocusId } from '@/types/PageFocusId';
import { useHotkeysOnFocusedElement } from '@/ui/utilities/hotkey/hooks/useHotkeysOnFocusedElement';
import { useNavigate } from 'react-router-dom';

// On the full record page, Space (or Option+Space) goes back in history to
// where you came from. Only fires when the page itself is focused, so editing
// a field with the space bar still works.
export const useRecordShowPageGoBackHotkey = () => {
  const navigate = useNavigate();

  useHotkeysOnFocusedElement({
    keys: ['space', 'alt+space'],
    callback: () => {
      navigate(-1);
    },
    focusId: PageFocusId.RecordShowPage,
    dependencies: [navigate],
  });
};
