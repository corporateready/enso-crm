import { useLazyQuery, useMutation } from '@apollo/client/react';
import { styled } from '@linaria/react';
import { useState } from 'react';

import { AppPath } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { Button, Checkbox } from 'twenty-ui/input';
import { ModalContent, ModalFooter, ModalHeader } from 'twenty-ui/layout';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { currentWorkspaceMemberState } from '@/auth/states/currentWorkspaceMemberState';
import { NewLeadChoiceButtons } from '@/enso/manual-lead/components/NewLeadChoiceButtons';
import { NewLeadDuplicateNotice } from '@/enso/manual-lead/components/NewLeadDuplicateNotice';
import { NEW_LEAD_CALLING_CODE_OPTIONS } from '@/enso/manual-lead/constants/NewLeadCallingCodeOptions';
import { NEW_LEAD_CONSENT_CHANNEL_OPTIONS } from '@/enso/manual-lead/constants/NewLeadConsentChannelOptions';
import { NEW_LEAD_FIRST_CONTACT_CHANNEL_OPTIONS } from '@/enso/manual-lead/constants/NewLeadFirstContactChannelOptions';
import { ENSO_CREATE_MANUAL_LEAD } from '@/enso/manual-lead/graphql/ensoCreateManualLead';
import { ENSO_MANUAL_LEAD_DUPLICATE_CHECK } from '@/enso/manual-lead/graphql/ensoManualLeadDuplicateCheck';
import {
  type ManualLeadSourceRecord,
  type NewLeadDestination,
  type NewLeadDuplicateCheck,
  type NewLeadFormValues,
  type NewLeadStartStage,
} from '@/enso/manual-lead/types/NewLeadFormValues';
import { buildCreateManualLeadInput } from '@/enso/manual-lead/utils/buildCreateManualLeadInput';
import { toDateTimeLocalValue } from '@/enso/manual-lead/utils/toDateTimeLocalValue';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { Select } from '@/ui/input/components/Select';
import { TextArea } from '@/ui/input/components/TextArea';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useNavigateApp } from '~/hooks/useNavigateApp';

const StyledBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[4]};
  width: 100%;
`;

const StyledSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledSectionTitle = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.md};
  font-weight: ${themeCssVariables.font.weight.semiBold};
`;

const StyledHint = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledRow = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[2]};

  > * {
    flex: 1;
    min-width: 0;
  }
`;

const StyledInput = styled.input`
  background: ${themeCssVariables.background.transparent.lighter};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  box-sizing: border-box;
  color: ${themeCssVariables.font.color.primary};
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.md};
  padding: ${themeCssVariables.spacing[2]};
  width: 100%;
`;

const StyledFieldLabel = styled.label`
  color: ${themeCssVariables.font.color.light};
  display: flex;
  flex-direction: column;
  font-size: ${themeCssVariables.font.size.xs};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  gap: ${themeCssVariables.spacing[1]};
`;

const StyledCheckboxRow = styled.label`
  align-items: center;
  color: ${themeCssVariables.font.color.primary};
  cursor: pointer;
  display: flex;
  font-size: ${themeCssVariables.font.size.md};
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledError = styled.div`
  color: ${themeCssVariables.font.color.danger};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledTitle = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.md};
  font-weight: 500;
`;

const StyledFooter = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: flex-end;
  width: 100%;
`;

const DESTINATION_OPTIONS: { label: string; value: NewLeadDestination }[] = [
  { label: 'Me', value: 'MINE' },
  { label: 'A colleague', value: 'COLLEAGUE' },
  { label: 'Routing', value: 'ROUTING' },
];

const START_STAGE_OPTIONS: { label: string; value: NewLeadStartStage }[] = [
  { label: 'Not contacted yet', value: 'LEAD_CLAIMED' },
  { label: 'Already talked', value: 'CONNECTED' },
];

type NamedRecord = {
  id: string;
  name?: string | { firstName?: string; lastName?: string } | null;
};

const recordLabel = (record: NamedRecord) =>
  typeof record.name === 'string'
    ? record.name
    : `${record.name?.firstName ?? ''} ${record.name?.lastName ?? ''}`.trim() ||
      'Unnamed';

const hasCheckableContact = (values: NewLeadFormValues) =>
  values.phoneNumber.replace(/\D/g, '').length >= 7 ||
  values.email.includes('@');

type NewLeadFormProps = {
  requestId: string;
  onClose: () => void;
};

export const NewLeadForm = ({ requestId, onClose }: NewLeadFormProps) => {
  const currentWorkspaceMember = useAtomStateValue(currentWorkspaceMemberState);
  const navigateApp = useNavigateApp();
  const { enqueueSuccessSnackBar } = useSnackBar();

  const [values, setValues] = useState<NewLeadFormValues>(() => {
    const now = toDateTimeLocalValue(new Date());

    return {
      projectId: '',
      firstName: '',
      lastName: '',
      phoneCallingCode: '+373',
      phoneNumber: '',
      email: '',
      manualLeadSourceId: '',
      referredByName: '',
      occurredAt: now,
      destination: 'MINE',
      colleagueWorkspaceMemberId: '',
      startStage: 'LEAD_CLAIMED',
      firstContactAt: now,
      firstContactChannel: 'CALL',
      note: '',
      verbalConsentChannels: [],
    };
  });
  const [error, setError] = useState<string | null>(null);

  const setValue = <TKey extends keyof NewLeadFormValues>(
    key: TKey,
    value: NewLeadFormValues[TKey],
  ) => setValues((previous) => ({ ...previous, [key]: value }));

  const { records: projectRecords } = useFindManyRecords({
    objectNameSingular: 'project',
    recordGqlFields: { id: true, name: true },
    orderBy: [{ name: 'AscNullsLast' }],
  });

  const { records: sourceRecords } = useFindManyRecords({
    objectNameSingular: 'manualLeadSource',
    recordGqlFields: { id: true, name: true, category: true, projectId: true },
    filter: { isActive: { eq: true } },
    orderBy: [{ name: 'AscNullsLast' }],
  });

  const { records: memberRecords } = useFindManyRecords({
    objectNameSingular: 'workspaceMember',
    recordGqlFields: { id: true, name: { firstName: true, lastName: true } },
  });

  const projects = (projectRecords ?? []) as NamedRecord[];
  const sources = (sourceRecords ?? []) as (ManualLeadSourceRecord &
    NamedRecord)[];
  const members = (memberRecords ?? []) as NamedRecord[];

  // A source tied to a project is only offered for that project's leads.
  const sourcesForProject = sources.filter(
    (source) =>
      !isDefined(source.projectId) || source.projectId === values.projectId,
  );

  const selectedSource = sourcesForProject.find(
    (source) => source.id === values.manualLeadSourceId,
  );

  const [runDuplicateCheck, { data: duplicateData }] = useLazyQuery<{
    ensoManualLeadDuplicateCheck: NewLeadDuplicateCheck;
  }>(ENSO_MANUAL_LEAD_DUPLICATE_CHECK, { fetchPolicy: 'network-only' });

  const [createManualLead, { loading: isSubmitting }] = useMutation<{
    ensoCreateManualLead: {
      success: boolean;
      error: string | null;
      personId: string | null;
      opportunityId: string | null;
      isNewDeal: boolean;
    };
  }>(ENSO_CREATE_MANUAL_LEAD);

  const checkForDuplicates = (nextValues: NewLeadFormValues) => {
    if (nextValues.projectId === '' || !hasCheckableContact(nextValues)) {
      return;
    }

    void runDuplicateCheck({
      variables: {
        input: {
          projectId: nextValues.projectId,
          phoneNumber: nextValues.phoneNumber.trim() || undefined,
          phoneCallingCode: nextValues.phoneNumber.trim()
            ? nextValues.phoneCallingCode
            : undefined,
          email: nextValues.email.trim() || undefined,
        },
      },
    });
  };

  const duplicateCheck = duplicateData?.ensoManualLeadDuplicateCheck ?? null;
  const isBlocked =
    duplicateCheck?.verdict === 'BLOCKED' && !duplicateCheck.isRateLimited;

  const missingRequired =
    values.projectId === '' ||
    values.firstName.trim() === '' ||
    !hasCheckableContact(values) ||
    values.manualLeadSourceId === '' ||
    (values.destination === 'COLLEAGUE' &&
      values.colleagueWorkspaceMemberId === '');

  const handleSubmit = async () => {
    setError(null);

    const result = await createManualLead({
      variables: { input: buildCreateManualLeadInput(values, requestId) },
    }).catch((submitError: Error) => {
      setError(submitError.message);

      return null;
    });

    const outcome = result?.data?.ensoCreateManualLead;

    if (!isDefined(outcome)) {
      return;
    }

    if (!outcome.success) {
      setError(outcome.error ?? 'The lead could not be added.');

      return;
    }

    enqueueSuccessSnackBar({
      message: outcome.isNewDeal
        ? 'Lead added'
        : 'Lead added to the existing deal',
    });
    onClose();

    if (isDefined(outcome.opportunityId)) {
      navigateApp(AppPath.RecordShowPage, {
        objectNameSingular: 'opportunity',
        objectRecordId: outcome.opportunityId,
      });
    } else if (isDefined(outcome.personId)) {
      navigateApp(AppPath.RecordShowPage, {
        objectNameSingular: 'person',
        objectRecordId: outcome.personId,
      });
    }
  };

  const colleagueOptions = members
    .filter((member) => member.id !== currentWorkspaceMember?.id)
    .map((member) => ({ label: recordLabel(member), value: member.id }));

  return (
    <>
      <ModalHeader>
        <StyledTitle>New lead</StyledTitle>
      </ModalHeader>
      <ModalContent>
        <StyledBody>
          <StyledSection>
            <Select
              dropdownId="new-lead-project"
              label="Project"
              options={projects.map((project) => ({
                label: recordLabel(project),
                value: project.id,
              }))}
              emptyOption={{ label: 'Choose a project…', value: '' }}
              value={values.projectId}
              onChange={(projectId) => {
                const nextValues = {
                  ...values,
                  projectId,
                  manualLeadSourceId: '',
                };

                setValues(nextValues);
                checkForDuplicates(nextValues);
              }}
              withSearchInput
              fullWidth
              isDropdownInModal
            />
          </StyledSection>

          <StyledSection>
            <StyledSectionTitle>Who is it?</StyledSectionTitle>
            <StyledRow>
              <StyledFieldLabel>
                First name
                <StyledInput
                  value={values.firstName}
                  onChange={(event) =>
                    setValue('firstName', event.target.value)
                  }
                />
              </StyledFieldLabel>
              <StyledFieldLabel>
                Last name
                <StyledInput
                  value={values.lastName}
                  onChange={(event) => setValue('lastName', event.target.value)}
                />
              </StyledFieldLabel>
            </StyledRow>
            <StyledRow>
              <Select
                dropdownId="new-lead-calling-code"
                label="Code"
                options={NEW_LEAD_CALLING_CODE_OPTIONS}
                value={values.phoneCallingCode}
                onChange={(phoneCallingCode) =>
                  setValue('phoneCallingCode', phoneCallingCode)
                }
                fullWidth
                isDropdownInModal
              />
              <StyledFieldLabel>
                Phone
                <StyledInput
                  inputMode="tel"
                  value={values.phoneNumber}
                  onChange={(event) =>
                    setValue('phoneNumber', event.target.value)
                  }
                  onBlur={() => checkForDuplicates(values)}
                />
              </StyledFieldLabel>
            </StyledRow>
            <StyledFieldLabel>
              Email
              <StyledInput
                type="email"
                value={values.email}
                onChange={(event) => setValue('email', event.target.value)}
                onBlur={() => checkForDuplicates(values)}
              />
            </StyledFieldLabel>
            <StyledHint>A phone number or an email is required.</StyledHint>
            <NewLeadDuplicateNotice check={duplicateCheck} />
          </StyledSection>

          <StyledSection>
            <StyledSectionTitle>
              How did this lead reach you?
            </StyledSectionTitle>
            <Select
              dropdownId="new-lead-source"
              options={sourcesForProject.map((source) => ({
                label: recordLabel(source),
                value: source.id,
              }))}
              emptyOption={{
                label:
                  values.projectId === ''
                    ? 'Choose a project first'
                    : 'Choose a source…',
                value: '',
              }}
              value={values.manualLeadSourceId}
              onChange={(manualLeadSourceId) =>
                setValue('manualLeadSourceId', manualLeadSourceId)
              }
              disabled={values.projectId === ''}
              fullWidth
              isDropdownInModal
            />
            {selectedSource?.category === 'REFERRAL' && (
              <StyledFieldLabel>
                Who referred them?
                <StyledInput
                  value={values.referredByName}
                  onChange={(event) =>
                    setValue('referredByName', event.target.value)
                  }
                />
              </StyledFieldLabel>
            )}
            <StyledFieldLabel>
              When
              <StyledInput
                type="datetime-local"
                value={values.occurredAt}
                onChange={(event) => setValue('occurredAt', event.target.value)}
              />
            </StyledFieldLabel>
          </StyledSection>

          <StyledSection>
            <StyledSectionTitle>Who works this lead?</StyledSectionTitle>
            <NewLeadChoiceButtons
              options={DESTINATION_OPTIONS}
              value={values.destination}
              onChange={(destination) => setValue('destination', destination)}
            />
            {values.destination === 'MINE' && (
              <>
                <NewLeadChoiceButtons
                  options={START_STAGE_OPTIONS}
                  value={values.startStage}
                  onChange={(startStage) => setValue('startStage', startStage)}
                />
                {values.startStage === 'CONNECTED' ? (
                  <StyledRow>
                    <StyledFieldLabel>
                      First contact
                      <StyledInput
                        type="datetime-local"
                        value={values.firstContactAt}
                        onChange={(event) =>
                          setValue('firstContactAt', event.target.value)
                        }
                      />
                    </StyledFieldLabel>
                    <Select
                      dropdownId="new-lead-first-contact-channel"
                      label="Channel"
                      options={NEW_LEAD_FIRST_CONTACT_CHANNEL_OPTIONS}
                      value={values.firstContactChannel}
                      onChange={(firstContactChannel) =>
                        setValue('firstContactChannel', firstContactChannel)
                      }
                      fullWidth
                      isDropdownInModal
                    />
                  </StyledRow>
                ) : (
                  <StyledHint>
                    You get a “First contact” task due today.
                  </StyledHint>
                )}
              </>
            )}
            {values.destination === 'COLLEAGUE' && (
              <>
                <Select
                  dropdownId="new-lead-colleague"
                  options={colleagueOptions}
                  emptyOption={{ label: 'Choose a colleague…', value: '' }}
                  value={values.colleagueWorkspaceMemberId}
                  onChange={(colleagueWorkspaceMemberId) =>
                    setValue(
                      'colleagueWorkspaceMemberId',
                      colleagueWorkspaceMemberId,
                    )
                  }
                  withSearchInput
                  fullWidth
                  isDropdownInModal
                />
                <StyledHint>
                  They get the deal at Lead Claimed, a “First contact” task and
                  a Google Chat message from you.
                </StyledHint>
              </>
            )}
            {values.destination === 'ROUTING' && (
              <StyledHint>
                The lead waits in routing until someone in the project’s routing
                team is available, and goes to whoever routing picks.
              </StyledHint>
            )}
          </StyledSection>

          <StyledSection>
            <StyledSectionTitle>
              The client agreed to be contacted by
            </StyledSectionTitle>
            {NEW_LEAD_CONSENT_CHANNEL_OPTIONS.map((option) => (
              <StyledCheckboxRow key={option.value}>
                <Checkbox
                  checked={values.verbalConsentChannels.includes(option.value)}
                  onCheckedChange={(checked) =>
                    setValue(
                      'verbalConsentChannels',
                      checked
                        ? [...values.verbalConsentChannels, option.value]
                        : values.verbalConsentChannels.filter(
                            (channel) => channel !== option.value,
                          ),
                    )
                  }
                />
                {option.label}
              </StyledCheckboxRow>
            ))}
            <StyledHint>
              Tick only what they said yes to. Leave all unticked if you didn’t
              ask.
            </StyledHint>
          </StyledSection>

          <StyledSection>
            <StyledSectionTitle>Note</StyledSectionTitle>
            <TextArea
              textAreaId="new-lead-note"
              placeholder="What do they want? Anything the next person should know…"
              value={values.note}
              onChange={(note) => setValue('note', note)}
              minRows={3}
            />
          </StyledSection>

          {isDefined(error) && <StyledError>{error}</StyledError>}
        </StyledBody>
      </ModalContent>
      <ModalFooter>
        <StyledFooter>
          <Button title="Cancel" variant="secondary" onClick={onClose} />
          <Button
            title={isSubmitting ? 'Adding…' : 'Add lead'}
            variant="primary"
            accent="blue"
            disabled={missingRequired || isBlocked || isSubmitting}
            onClick={handleSubmit}
          />
        </StyledFooter>
      </ModalFooter>
    </>
  );
};
