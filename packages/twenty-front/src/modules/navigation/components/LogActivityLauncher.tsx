import { styled } from '@linaria/react';
import { useState } from 'react';

import { isDefined } from 'twenty-shared/utils';
import { IconBolt } from 'twenty-ui/display';
import { Button } from 'twenty-ui/input';
import { ModalContent, ModalHeader } from 'twenty-ui/layout';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { FormSingleRecordPicker } from '@/object-record/record-field/ui/form-types/components/FormSingleRecordPicker';
import { TaskActionsWidget } from '@/page-layout/widgets/task-actions/components/TaskActionsWidget';
import { LayoutRenderingProvider } from '@/ui/layout/contexts/LayoutRenderingContext';
import { ModalStatefulWrapper } from '@/ui/layout/modal/components/ModalStatefulWrapper';
import { useModal } from '@/ui/layout/modal/hooks/useModal';
import { NavigationDrawerItem } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerItem';
import { NavigationDrawerSection } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerSection';
import { PageLayoutType } from '~/generated-metadata/graphql';

// Global "Log activity" entry point: log a touch against any deal / person /
// company from anywhere, without opening the record. Pick the object type +
// the record, then host the same channel-aware Actions surface in the modal
// (via a synthetic LayoutRenderingContext, so the widget runs in object mode).
const LAUNCHER_MODAL_ID = 'enso-log-activity-launcher';

const OBJECT_TYPES: { label: string; value: string }[] = [
  { label: 'Deal', value: 'opportunity' },
  { label: 'Person', value: 'person' },
  { label: 'Company', value: 'company' },
];

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
  const { openModal } = useModal();
  const [objectType, setObjectType] = useState<string>('opportunity');
  const [pickedRecordId, setPickedRecordId] = useState<string | null>(null);

  const reset = () => {
    setObjectType('opportunity');
    setPickedRecordId(null);
  };

  const handleOpen = () => {
    reset();
    openModal(LAUNCHER_MODAL_ID);
  };

  const typeLabel =
    OBJECT_TYPES.find((option) => option.value === objectType)?.label ??
    'record';

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
        onClose={reset}
      >
        <ModalHeader>
          <StyledTitle>Log activity</StyledTitle>
        </ModalHeader>
        <ModalContent>
          <StyledBody>
            {isDefined(pickedRecordId) ? (
              <>
                <StyledRow>
                  <Button
                    title="Pick another record"
                    variant="secondary"
                    onClick={() => setPickedRecordId(null)}
                  />
                </StyledRow>
                <LayoutRenderingProvider
                  value={{
                    targetRecordIdentifier: {
                      id: pickedRecordId,
                      targetObjectNameSingular: objectType,
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
                <StyledLabel>Log a touch against…</StyledLabel>
                <StyledRow>
                  {OBJECT_TYPES.map((option) => (
                    <Button
                      key={option.value}
                      title={option.label}
                      variant={
                        objectType === option.value ? 'primary' : 'secondary'
                      }
                      accent={objectType === option.value ? 'blue' : 'default'}
                      onClick={() => setObjectType(option.value)}
                    />
                  ))}
                </StyledRow>
                <FormSingleRecordPicker
                  key={objectType}
                  label={`Pick a ${typeLabel.toLowerCase()}`}
                  objectNameSingulars={[objectType]}
                  defaultValue={null}
                  onChange={(value) => {
                    if (typeof value === 'string' && value !== '') {
                      setPickedRecordId(value);
                    }
                  }}
                />
              </>
            )}
          </StyledBody>
        </ModalContent>
      </ModalStatefulWrapper>
    </NavigationDrawerSection>
  );
};
