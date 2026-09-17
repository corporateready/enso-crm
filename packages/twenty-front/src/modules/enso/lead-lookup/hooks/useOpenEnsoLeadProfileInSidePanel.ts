import { useStore } from 'jotai';
import { useCallback } from 'react';
import { t } from '@lingui/core/macro';
import { v4 } from 'uuid';
import { SidePanelPages } from 'twenty-shared/types';
import { IconLock } from 'twenty-ui/display';

import { ensoLeadProfileSubjectComponentState } from '@/enso/lead-lookup/states/ensoLeadProfileSubjectComponentState';
import { type EnsoLeadProfileSubject } from '@/enso/lead-lookup/types/EnsoLeadProfileSubject';
import { useNavigateSidePanel } from '@/side-panel/hooks/useNavigateSidePanel';

export const useOpenEnsoLeadProfileInSidePanel = () => {
  const store = useStore();
  const { navigateSidePanel } = useNavigateSidePanel();

  const openEnsoLeadProfileInSidePanel = useCallback(
    (subject: EnsoLeadProfileSubject, pageTitle: string) => {
      const pageComponentInstanceId = v4();

      store.set(
        ensoLeadProfileSubjectComponentState.atomFamily({
          instanceId: pageComponentInstanceId,
        }),
        subject,
      );

      navigateSidePanel({
        page: SidePanelPages.EnsoLeadProfile,
        // The padlock is the whole message: this opens, and it does not edit.
        pageTitle: pageTitle || t`Lead`,
        pageIcon: IconLock,
        pageId: pageComponentInstanceId,
      });
    },
    [navigateSidePanel, store],
  );

  return { openEnsoLeadProfileInSidePanel };
};
