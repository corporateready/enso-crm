import { useState } from 'react';

import { IconUserPlus } from 'twenty-ui/display';
import { v4 } from 'uuid';

import { NewLeadForm } from '@/enso/manual-lead/components/NewLeadForm';
import { SIDEBAR_UTILITY_ICON_COLOR } from '@/navigation/constants/SidebarUtilityIconColor';
import { useDoObjectMetadataItemsExist } from '@/object-metadata/hooks/useDoObjectMetadataItemsExist';
import { ModalStatefulWrapper } from '@/ui/layout/modal/components/ModalStatefulWrapper';
import { useModal } from '@/ui/layout/modal/hooks/useModal';
import { NavigationDrawerItem } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerItem';

const NEW_LEAD_MODAL_ID = 'enso-new-lead-launcher';

// The one place a manager adds a lead they found themselves
// (docs/manual-lead-entry.md). The form only mounts while the modal is open,
// with a fresh request id each time, so reopening starts clean and a double
// submit of one form can never add the lead twice.
export const NewLeadLauncher = () => {
  // useFindManyRecords throws rather than no-ops before the workspace metadata
  // is hydrated, and there is nothing to add a lead to without these objects.
  const doObjectsExist = useDoObjectMetadataItemsExist([
    'project',
    'manualLeadSource',
  ]);

  if (!doObjectsExist) {
    return null;
  }

  return <NewLeadLauncherContent />;
};

const NewLeadLauncherContent = () => {
  const { openModal, closeModal } = useModal();
  const [requestId, setRequestId] = useState<string | null>(null);

  const handleOpen = () => {
    setRequestId(v4());
    openModal(NEW_LEAD_MODAL_ID);
  };

  const handleClose = () => {
    closeModal(NEW_LEAD_MODAL_ID);
    setRequestId(null);
  };

  return (
    <>
      <NavigationDrawerItem
        label="New lead"
        Icon={IconUserPlus}
        iconColor={SIDEBAR_UTILITY_ICON_COLOR}
        onClick={handleOpen}
      />
      <ModalStatefulWrapper
        modalInstanceId={NEW_LEAD_MODAL_ID}
        size="medium"
        padding="medium"
        isClosable
        // The form's dropdowns render outside the modal; a click in one must
        // not count as a click outside that closes the form.
        shouldCloseModalOnClickOutsideOrEscape={false}
        onClose={() => setRequestId(null)}
      >
        {requestId !== null && (
          <NewLeadForm
            key={requestId}
            requestId={requestId}
            onClose={handleClose}
          />
        )}
      </ModalStatefulWrapper>
    </>
  );
};
