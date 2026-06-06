import { useLingui } from '@lingui/react/macro';
import { styled } from '@linaria/react';
import { useState } from 'react';
import { isDefined } from 'twenty-shared/utils';
import { MOBILE_VIEWPORT, themeCssVariables } from 'twenty-ui/theme-constants';

import { useCreateOneRecord } from '@/object-record/hooks/useCreateOneRecord';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { useLayoutRenderingContext } from '@/ui/layout/contexts/LayoutRenderingContext';

// ENSO — manager-facing marketing-consent card on the Person record. A manager
// who gets a phone number in conversation records consent here in one place:
// toggle a channel and the personProjectConsent write-audit hook stamps
// source=VERBAL + consentedAt (grant) or revokedAt (revoke), with updatedBy =
// the manager. Per person × project (consent is purpose-scoped). Surfaced via
// the IframeWidget marker, like the Chatwoot embed.
export const ENSO_PERSON_CONSENT_MARKER = '__enso_person_consent';

const CHANNELS = [
  { key: 'call', label: 'Call' },
  { key: 'sms', label: 'SMS' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'email', label: 'Email' },
] as const;

const CONSENT_GQL_FIELDS = {
  id: true,
  name: true,
  projectId: true,
  emailMarketingConsent: true,
  smsMarketingConsent: true,
  whatsappMarketingConsent: true,
  callMarketingConsent: true,
  emailMarketingConsentSource: true,
  callMarketingConsentSource: true,
};

const StyledContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  padding: ${themeCssVariables.spacing[2]};
  width: 100%;
`;

const StyledHint = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
`;

const StyledRow = styled.div`
  align-items: center;
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
  padding: ${themeCssVariables.spacing[2]};
  @media (max-width: ${MOBILE_VIEWPORT}px) {
    flex-direction: column;
    align-items: flex-start;
  }
`;

const StyledProjectName = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-weight: ${themeCssVariables.font.weight.medium};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledChips = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
  flex-wrap: wrap;
`;

const StyledChip = styled.button<{ $active: boolean }>`
  background: ${({ $active }) =>
    $active
      ? themeCssVariables.color.green
      : themeCssVariables.background.tertiary};
  border: none;
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${({ $active }) =>
    $active
      ? themeCssVariables.font.color.inverted
      : themeCssVariables.font.color.secondary};
  cursor: pointer;
  font-size: ${themeCssVariables.font.size.sm};
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
`;

const StyledAddRow = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledSelect = styled.select`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  flex: 1;
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
`;

const StyledAddButton = styled.button`
  background: ${themeCssVariables.color.blue};
  border: none;
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.inverted};
  cursor: pointer;
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
`;

export const PersonConsentCard = () => {
  const { t } = useLingui();
  const { targetRecordIdentifier } = useLayoutRenderingContext();
  const personId = targetRecordIdentifier?.id;
  const isPerson =
    targetRecordIdentifier?.targetObjectNameSingular === 'person';

  const [addProjectId, setAddProjectId] = useState('');

  const { records: consents = [], loading } = useFindManyRecords({
    objectNameSingular: 'personProjectConsent',
    filter: { personId: { eq: personId } },
    recordGqlFields: CONSENT_GQL_FIELDS,
    skip: !isDefined(personId) || !isPerson,
  });

  const { records: projects = [] } = useFindManyRecords({
    objectNameSingular: 'project',
    recordGqlFields: { id: true, name: true },
    skip: !isPerson,
    limit: 60,
  });

  const { createOneRecord } = useCreateOneRecord({
    objectNameSingular: 'personProjectConsent',
  });
  const { updateOneRecord } = useUpdateOneRecord();

  if (!isPerson || !isDefined(personId)) {
    return null;
  }

  const consentedProjectIds = new Set(
    consents.map((consent) => consent.projectId),
  );
  const addableProjects = projects.filter(
    (project) => !consentedProjectIds.has(project.id),
  );

  const toggleChannel = async (
    consent: Record<string, unknown>,
    channelKey: string,
  ) => {
    const field = `${channelKey}MarketingConsent`;
    const nextValue = consent[field] !== true;

    await updateOneRecord({
      objectNameSingular: 'personProjectConsent',
      idToUpdate: consent.id as string,
      updateOneRecordInput: { [field]: nextValue },
      optimisticRecord: { [field]: nextValue },
    });
  };

  // New consent for a project defaults to "call" on — the "they gave a number
  // to be called" case. The manager can toggle the other channels after.
  const addConsent = async () => {
    if (addProjectId === '' || consentedProjectIds.has(addProjectId)) {
      return;
    }

    await createOneRecord({
      personId,
      projectId: addProjectId,
      callMarketingConsent: true,
    });

    setAddProjectId('');
  };

  return (
    <StyledContainer>
      <StyledHint>
        {t`Record consent per project. Turning a channel on logs verbal consent (source VERBAL) with the date and who recorded it; turning it off records the opt-out.`}
      </StyledHint>

      {loading ? (
        <StyledHint>{t`Loading…`}</StyledHint>
      ) : (
        consents.map((consent) => (
          <StyledRow key={consent.id as string}>
            <StyledProjectName>
              {(consent.name as string) ?? t`Consent`}
            </StyledProjectName>
            <StyledChips>
              {CHANNELS.map((channel) => (
                <StyledChip
                  key={channel.key}
                  $active={consent[`${channel.key}MarketingConsent`] === true}
                  onClick={() => toggleChannel(consent, channel.key)}
                >
                  {channel.label}
                </StyledChip>
              ))}
            </StyledChips>
          </StyledRow>
        ))
      )}

      {addableProjects.length > 0 && (
        <StyledAddRow>
          <StyledSelect
            value={addProjectId}
            onChange={(event) => setAddProjectId(event.target.value)}
          >
            <option value="">{t`Add consent for a project…`}</option>
            {addableProjects.map((project) => (
              <option key={project.id} value={project.id as string}>
                {project.name as string}
              </option>
            ))}
          </StyledSelect>
          <StyledAddButton onClick={addConsent} disabled={addProjectId === ''}>
            {t`Add`}
          </StyledAddButton>
        </StyledAddRow>
      )}
    </StyledContainer>
  );
};
