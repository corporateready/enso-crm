import { PageFocusId } from '@/types/PageFocusId';
import { useHotkeysOnFocusedElement } from '@/ui/utilities/hotkey/hooks/useHotkeysOnFocusedElement';
import { useNavigate } from 'react-router-dom';

// On the full record page, Option+Space (Alt+Space) goes back to where you came
// from. A plain Space is left untouched so the page can still scroll.
export const useRecordShowPageGoBackOnAltSpaceHotkey = () => {
  const navigate = useNavigate();

  useHotkeysOnFocusedElement({
    keys: ['alt+space'],
    callback: () => {
      navigate(-1);
    },
    focusId: PageFocusId.RecordShowPage,
    dependencies: [navigate],
  });
};
