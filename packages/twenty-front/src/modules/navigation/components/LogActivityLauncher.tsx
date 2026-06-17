import { styled } from '@linaria/react';
import { useState } from 'react';

import { isDefined } from 'twenty-shared/utils';
import { IconBolt } from 'twenty-ui/display';
import { Button } from 'twenty-ui/input';
import { ModalContent, ModalFooter, ModalHeader } from 'twenty-ui/layout';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { TaskActionsWidget } from '@/page-layout/widgets/task-actions/components/TaskActionsWidget';
import { LayoutRenderingProvider } from '@/ui/layout/contexts/LayoutRenderingContext';
import { ModalStatefulWrapper } from '@/ui/layout/modal/components/ModalStatefulWrapper';
import { useModal } from '@/ui/layout/modal/hooks/useModal';
import { NavigationDrawerItem } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerItem';
import { NavigationDrawerSection } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerSection';
import { PageLayoutType } from '~/generated-metadata/graphql';

// Global "Log activity" entry point. A touch always targets a PERSON, so the
// launcher searches contacts (a self-contained list — not the form record
// picker, which doesn't behave when mounted in the nav drawer), then hosts the
// same channel-aware Actions surface in person mode via a synthetic context.
const LAUNCHER_MODAL_ID = 'enso-log-activity-launcher';

const StyledBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  width: 100%;
`;

const StyledLabel = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledSearchInput = styled.input`
  background: ${themeCssVariables.background.transparent.lighter};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.md};
  padding: ${themeCssVariables.spacing[2]};
  width: 100%;
`;

const StyledResults = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
  max-height: 220px;
  overflow-y: auto;
`;

const StyledResultRow = styled.button`
  background: transparent;
  border: none;
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  cursor: pointer;
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.md};
  padding: ${themeCssVariables.spacing[2]};
  text-align: left;
  width: 100%;

  &:hover {
    background: ${themeCssVariables.background.transparent.light};
  }
`;

const StyledTitle = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.md};
  font-weight: 500;
`;

type PersonRecord = {
  id: string;
  name?: { firstName?: string; lastName?: string } | null;
};

const personLabel = (person: PersonRecord) =>
  `${person.name?.firstName ?? ''} ${person.name?.lastName ?? ''}`.trim() ||
  'Unnamed contact';

export const LogActivityLauncher = () => {
  const { openModal, closeModal } = useModal();
  const [pickedPersonId, setPickedPersonId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const trimmedSearch = search.trim();
  const { records } = useFindManyRecords({
    objectNameSingular: 'person',
    recordGqlFields: { id: true, name: { firstName: true, lastName: true } },
    limit: 8,
    ...(trimmedSearch !== ''
      ? {
          filter: {
            or: [
              { name: { firstName: { ilike: `%${trimmedSearch}%` } } },
              { name: { lastName: { ilike: `%${trimmedSearch}%` } } },
            ],
          },
        }
      : {}),
  });
  const people = (records ?? []) as PersonRecord[];

  const reset = () => {
    setPickedPersonId(null);
    setSearch('');
  };

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
                <Button
                  title="Pick another contact"
                  variant="secondary"
                  onClick={reset}
                />
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
                <StyledSearchInput
                  autoFocus
                  placeholder="Search a contact by name…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <StyledResults>
                  {people.map((person) => (
                    <StyledResultRow
                      key={person.id}
                      onClick={() => setPickedPersonId(person.id)}
                    >
                      {personLabel(person)}
                    </StyledResultRow>
                  ))}
                  {people.length === 0 && (
                    <StyledLabel>No matching contact</StyledLabel>
                  )}
                </StyledResults>
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
