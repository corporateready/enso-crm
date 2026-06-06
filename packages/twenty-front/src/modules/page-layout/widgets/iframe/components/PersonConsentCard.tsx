import { useLingui } from '@lingui/react/macro';
import { styled } from '@linaria/react';
import { useState } from 'react';
import { isDefined } from 'twenty-shared/utils';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { useCreateOneRecord } from '@/object-record/hooks/useCreateOneRecord';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { useLayoutRenderingContext } from '@/ui/layout/contexts/LayoutRenderingContext';

// ENSO — manager-facing marketing-consent card on the Person record. READ-ONLY
// by default (a stray click must not change consent): each channel shows its
// status + source + date. An explicit Edit mode enables changes; granting is
// provenance-safe (the audit hook never overwrites an existing grant's
// source/date) and revoking asks for confirmation. Per person × project.
export const ENSO_PERSON_CONSENT_MARKER = '__enso_person_consent';

const CHANNELS = [
  { key: 'call', label: 'Call' },
  { key: 'sms', label: 'SMS' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'email', label: 'Email' },
] as const;

const SOURCE_LABELS: Record<string, string> = {
  FORM_WEBSITE: 'Form',
  LEAD_AD: 'Lead Ad',
  VERBAL: 'Verbal',
  DOUBLE_OPT_IN: 'Double opt-in',
  MIGRATION: 'Imported',
  OTHER: 'Other',
};

const CONSENT_GQL_FIELDS = {
  id: true,
  name: true,
  projectId: true,
  emailMarketingConsent: true,
  emailMarketingConsentSource: true,
  emailMarketingConsentedAt: true,
  emailMarketingConsentRevokedAt: true,
  smsMarketingConsent: true,
  smsMarketingConsentSource: true,
  smsMarketingConsentedAt: true,
  smsMarketingConsentRevokedAt: true,
  whatsappMarketingConsent: true,
  whatsappMarketingConsentSource: true,
  whatsappMarketingConsentedAt: true,
  whatsappMarketingConsentRevokedAt: true,
  callMarketingConsent: true,
  callMarketingConsentSource: true,
  callMarketingConsentedAt: true,
  callMarketingConsentRevokedAt: true,
};

const formatDate = (value: unknown): string => {
  if (typeof value !== 'string' || value === '') {
    return '';
  }
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
};

const StyledContainer = styled.div`
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  max-width: 100%;
  overflow-x: hidden;
  padding: ${themeCssVariables.spacing[2]};
  width: 100%;

  & * {
    box-sizing: border-box;
  }
`;

const StyledHeader = styled.div`
  align-items: center;
  display: flex;
  justify-content: space-between;
`;

const StyledHint = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
`;

const StyledEditButton = styled.button`
  background: transparent;
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.secondary};
  cursor: pointer;
  flex: 0 0 auto;
  font-size: ${themeCssVariables.font.size.sm};
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
`;

const StyledRow = styled.div`
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[2]};
`;

const StyledProjectName = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-weight: ${themeCssVariables.font.weight.medium};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledChannelLine = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
`;

const StyledChannelLabel = styled.span`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.sm};
`;

// $state: 'on' (green) | 'off' (revoked, danger) | 'none' (not set, muted).
const StyledStatus = styled.button<{ $state: string; $editable: boolean }>`
  background: transparent;
  border: none;
  color: ${({ $state }) =>
    $state === 'on'
      ? themeCssVariables.color.green
      : $state === 'off'
        ? themeCssVariables.font.color.danger
        : themeCssVariables.font.color.tertiary};
  cursor: ${({ $editable }) => ($editable ? 'pointer' : 'default')};
  font-size: ${themeCssVariables.font.size.sm};
  padding: 0;
  text-align: right;
  text-decoration: ${({ $editable }) => ($editable ? 'underline' : 'none')};
  text-underline-offset: 2px;
`;

const StyledAddRow = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[2]};
  width: 100%;
`;

const StyledSelect = styled.select`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  flex: 1 1 auto;
  min-width: 0;
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
`;

const StyledAddButton = styled.button`
  background: ${themeCssVariables.color.blue};
  border: none;
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.inverted};
  cursor: pointer;
  flex: 0 0 auto;
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
`;

export const PersonConsentCard = () => {
  const { t } = useLingui();
  const { targetRecordIdentifier } = useLayoutRenderingContext();
  const personId = targetRecordIdentifier?.id;
  const isPerson =
    targetRecordIdentifier?.targetObjectNameSingular === 'person';

  const [addProjectId, setAddProjectId] = useState('');
  const [editMode, setEditMode] = useState(false);

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

  const channelState = (consent: Record<string, unknown>, key: string) => {
    const granted = consent[`${key}MarketingConsent`] === true;
    const revokedAt = consent[`${key}MarketingConsentRevokedAt`];
    const consentedAt = consent[`${key}MarketingConsentedAt`];
    const source = consent[`${key}MarketingConsentSource`] as string;

    if (granted) {
      const sourceLabel = SOURCE_LABELS[source] ?? source ?? t`Consent`;
      const date = formatDate(consentedAt);

      return { state: 'on', text: date ? `${sourceLabel} · ${date}` : sourceLabel };
    }

    if (isDefined(revokedAt)) {
      const date = formatDate(revokedAt);

      return { state: 'off', text: date ? t`Opted out · ${date}` : t`Opted out` };
    }

    return { state: 'none', text: t`Not set` };
  };

  const toggleChannel = async (
    consent: Record<string, unknown>,
    key: string,
    label: string,
    projectLabel: string,
  ) => {
    const isOn = consent[`${key}MarketingConsent`] === true;
    const nextValue = !isOn;

    // Revoking opts the person out — make it deliberate.
    if (
      !nextValue &&
      // eslint-disable-next-line no-alert
      !window.confirm(
        t`Opt ${projectLabel} out of ${label}? This records an opt-out.`,
      )
    ) {
      return;
    }

    await updateOneRecord({
      objectNameSingular: 'personProjectConsent',
      idToUpdate: consent.id as string,
      updateOneRecordInput: { [`${key}MarketingConsent`]: nextValue },
      optimisticRecord: { [`${key}MarketingConsent`]: nextValue },
    });
  };

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
      <StyledHeader>
        <StyledHint>
          {editMode
            ? t`Click a channel to grant; granting keeps any existing form consent. Revoking asks to confirm.`
            : t`Read-only. Click Edit to record verbal consent or an opt-out.`}
        </StyledHint>
        {consents.length > 0 && (
          <StyledEditButton onClick={() => setEditMode((value) => !value)}>
            {editMode ? t`Done` : t`Edit`}
          </StyledEditButton>
        )}
      </StyledHeader>

      {loading
        ? <StyledHint>{t`Loading…`}</StyledHint>
        : consents.map((consent) => {
            const projectLabel =
              ((consent.name as string) ?? '').split(' · ')[1] ??
              (consent.name as string) ??
              t`project`;

            return (
              <StyledRow key={consent.id as string}>
                <StyledProjectName>
                  {(consent.name as string) ?? t`Consent`}
                </StyledProjectName>
                {CHANNELS.map((channel) => {
                  const { state, text } = channelState(consent, channel.key);

                  return (
                    <StyledChannelLine key={channel.key}>
                      <StyledChannelLabel>{channel.label}</StyledChannelLabel>
                      <StyledStatus
                        $state={state}
                        $editable={editMode}
                        onClick={() =>
                          editMode &&
                          toggleChannel(
                            consent,
                            channel.key,
                            channel.label,
                            projectLabel,
                          )
                        }
                      >
                        {editMode
                          ? state === 'on'
                            ? t`${text} — opt out`
                            : t`Grant`
                          : text}
                      </StyledStatus>
                    </StyledChannelLine>
                  );
                })}
              </StyledRow>
            );
          })}

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
