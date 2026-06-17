import { styled } from '@linaria/react';
import { useState } from 'react';

import { isDefined } from 'twenty-shared/utils';
import { IconBolt } from 'twenty-ui/display';
import { Button } from 'twenty-ui/input';
import { ModalContent, ModalFooter, ModalHeader } from 'twenty-ui/layout';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { FormSingleRecordPicker } from '@/object-record/record-field/ui/form-types/components/FormSingleRecordPicker';
import { TaskActionsWidget } from '@/page-layout/widgets/task-actions/components/TaskActionsWidget';
import { LayoutRenderingProvider } from '@/ui/layout/contexts/LayoutRenderingContext';
import { ModalStatefulWrapper } from '@/ui/layout/modal/components/ModalStatefulWrapper';
import { useModal } from '@/ui/layout/modal/hooks/useModal';
import { NavigationDrawerItem } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerItem';
import { NavigationDrawerSection } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerSection';
import { PageLayoutType } from '~/generated-metadata/graphql';

// Global "Log activity" entry point. A touch always targets a PERSON, so the
// launcher picks a contact, then hosts the same channel-aware Actions surface in
// person mode (via a synthetic LayoutRenderingContext) — where the manager can
// optionally attach a related deal and pick the channel.
const LAUNCHER_MODAL_ID = 'enso-log-activity-launcher';

const StyledBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  width: 100%;
`;

const StyledRow = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledLabel = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledTitle = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.md};
  font-weight: 500;
`;

export const LogActivityLauncher = () => {
  const { openModal, closeModal } = useModal();
  const [pickedPersonId, setPickedPersonId] = useState<string | null>(null);

  const reset = () => setPickedPersonId(null);

  const handleOpen = () => {
    reset();
    openModal(LAUNCHER_MODAL_ID);
  };

  const handleClose = () => {
    closeModal(LAUNCHER_MODAL_ID);
    reset();
  };

  return (
    <NavigationDrawerSection>
      <NavigationDrawerItem
        label="Log activity"
        Icon={IconBolt}
        onClick={handleOpen}
      />
      <ModalStatefulWrapper
        modalInstanceId={LAUNCHER_MODAL_ID}
        size="medium"
        padding="medium"
        isClosable
        // The record picker renders its dropdown in a portal outside the modal,
        // so click-outside-to-close would dismiss the modal the moment you open
        // the picker. Disable it; close explicitly via the Close button.
        shouldCloseModalOnClickOutsideOrEscape={false}
        onClose={reset}
      >
        <ModalHeader>
          <StyledTitle>Log activity</StyledTitle>
        </ModalHeader>
        <ModalContent>
          <StyledBody>
            {isDefined(pickedPersonId) ? (
              <>
                <StyledRow>
                  <Button
                    title="Pick another contact"
                    variant="secondary"
                    onClick={() => setPickedPersonId(null)}
                  />
                </StyledRow>
                <LayoutRenderingProvider
                  value={{
                    targetRecordIdentifier: {
                      id: pickedPersonId,
                      targetObjectNameSingular: 'person',
                    },
                    layoutType: PageLayoutType.RECORD_PAGE,
                    isInSidePanel: false,
                  }}
                >
                  <TaskActionsWidget />
                </LayoutRenderingProvider>
              </>
            ) : (
              <>
                <StyledLabel>Who did you reach?</StyledLabel>
                <FormSingleRecordPicker
                  label="Pick a contact"
                  objectNameSingulars={['person']}
                  defaultValue={null}
                  onChange={(value) => {
                    if (typeof value === 'string' && value !== '') {
                      setPickedPersonId(value);
                    }
                  }}
                />
              </>
            )}
          </StyledBody>
        </ModalContent>
        <ModalFooter>
          <Button title="Close" variant="secondary" onClick={handleClose} />
        </ModalFooter>
      </ModalStatefulWrapper>
    </NavigationDrawerSection>
  );
};
