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
  FORM_WEBSITE: 'Website Form',
  LEAD_AD: 'Lead Ad',
  VERBAL: 'Verbal',
  DOUBLE_OPT_IN: 'Double opt-in',
  MIGRATION: 'Imported',
  WALK_IN: 'Walk-in',
  REFERRAL: 'Referral',
  MANUAL: 'Manual',
  IN_CHAT: 'Written (chat)',
  OTHER: 'Other',
};

// How a revoke happened (the event log's `method`).
const METHOD_LABELS: Record<string, string> = {
  UNSUBSCRIBE: 'Unsubscribe link',
  SMS_STOP: 'SMS STOP',
  WHATSAPP_OPTOUT: 'WhatsApp opt-out',
  MANUAL: 'Manual',
  VERBAL_REQUEST: 'Verbal/chat request',
  COMPLAINT: 'Complaint',
  LEGAL_ERASURE: 'Legal erasure (GDPR)',
  OTHER: 'Other',
};

const CHANNEL_LABELS: Record<string, string> = {
  EMAIL: 'Email',
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
  CALL: 'Call',
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

// Read-only audit trail (append-only personProjectConsentEvent). createdBy is an
// ACTOR composite — `true` fetches its subfields (name, source).
const EVENT_GQL_FIELDS = {
  id: true,
  name: true,
  channel: true,
  action: true,
  source: true,
  method: true,
  note: true,
  occurredAt: true,
  createdBy: true,
};

// Grant sources a manager can pick (the "how obtained"). Automated sources
// (FORM_WEBSITE/LEAD_AD) come from the pipeline, not this card.
const GRANT_SOURCES = [
  { value: 'VERBAL', label: 'Verbal (call)' },
  { value: 'IN_CHAT', label: 'Written (chat/DM)' },
  { value: 'WALK_IN', label: 'Walk-in' },
  { value: 'REFERRAL', label: 'Referral' },
  { value: 'MANUAL', label: 'Manual' },
] as const;

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

// Date + time for the audit trail (events are point-in-time, time matters).
const formatDateTime = (value: unknown): string => {
  if (typeof value !== 'string' || value === '') {
    return '';
  }
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
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

const StyledHistory = styled.div`
  border-top: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  margin-top: ${themeCssVariables.spacing[2]};
  padding-top: ${themeCssVariables.spacing[2]};
`;

const StyledHistoryTitle = styled.div`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.medium};
`;

const StyledHistoryItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
`;

const StyledHistoryHead = styled.div`
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[1]};
`;

// $action: GRANTED (green) | REVOKED (danger).
const StyledHistoryAction = styled.span<{ $action: string }>`
  color: ${({ $action }) =>
    $action === 'GRANTED'
      ? themeCssVariables.color.green
      : themeCssVariables.font.color.danger};
  font-size: ${themeCssVariables.font.size.xs};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  text-transform: uppercase;
`;

const StyledHistoryChannel = styled.span`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledHistoryMeta = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
`;

const StyledHistoryNote = styled.div`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.xs};
  font-style: italic;
`;

export const PersonConsentCard = () => {
  const { t } = useLingui();
  const { targetRecordIdentifier } = useLayoutRenderingContext();
  const personId = targetRecordIdentifier?.id;
  const isPerson =
    targetRecordIdentifier?.targetObjectNameSingular === 'person';

  const [addProjectId, setAddProjectId] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [grantSource, setGrantSource] = useState('VERBAL');

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

  const { records: events = [] } = useFindManyRecords({
    objectNameSingular: 'personProjectConsentEvent',
    filter: { personId: { eq: personId } },
    recordGqlFields: EVENT_GQL_FIELDS,
    skip: !isDefined(personId) || !isPerson,
    limit: 50,
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
    const neverConsented = !isDefined(consent[`${key}MarketingConsentedAt`]);

    if (isOn) {
      // Revoke — deliberate, with the "why" captured.
      // eslint-disable-next-line no-alert
      if (
        !window.confirm(
          t`Opt ${projectLabel} out of ${label}? This records an opt-out.`,
        )
      ) {
        return;
      }
      // eslint-disable-next-line no-alert
      const reason = window.prompt(t`Reason for opt-out (optional)`) ?? '';

      await updateOneRecord({
        objectNameSingular: 'personProjectConsent',
        idToUpdate: consent.id as string,
        updateOneRecordInput: {
          [`${key}MarketingConsent`]: false,
          lastRevokeMethod: 'MANUAL',
          ...(reason !== '' ? { lastChangeReason: reason } : {}),
        },
        optimisticRecord: { [`${key}MarketingConsent`]: false },
      });

      return;
    }

    // Grant — record the proof; set the source only on a FIRST-EVER grant so a
    // re-grant never overwrites existing provenance (the server guards this too).
    // eslint-disable-next-line no-alert
    const reason = window.prompt(t`Reason / proof (optional)`) ?? '';

    await updateOneRecord({
      objectNameSingular: 'personProjectConsent',
      idToUpdate: consent.id as string,
      updateOneRecordInput: {
        [`${key}MarketingConsent`]: true,
        ...(neverConsented
          ? { [`${key}MarketingConsentSource`]: grantSource }
          : {}),
        ...(reason !== '' ? { lastChangeReason: reason } : {}),
      },
      optimisticRecord: { [`${key}MarketingConsent`]: true },
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

      {editMode && consents.length > 0 && (
        <StyledAddRow>
          <StyledChannelLabel>{t`Grant source`}</StyledChannelLabel>
          <StyledSelect
            value={grantSource}
            onChange={(event) => setGrantSource(event.target.value)}
          >
            {GRANT_SOURCES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </StyledSelect>
        </StyledAddRow>
      )}

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

      {events.length > 0 && (
        <StyledHistory>
          <StyledHistoryTitle>{t`Consent history`}</StyledHistoryTitle>
          {[...events]
            .sort((first, second) =>
              String(second.occurredAt ?? '').localeCompare(
                String(first.occurredAt ?? ''),
              ),
            )
            .map((event) => {
              const action = (event.action as string) ?? '';
              const channelLabel =
                CHANNEL_LABELS[(event.channel as string) ?? ''] ??
                (event.channel as string) ??
                '';
              const projectLabel =
                ((event.name as string) ?? '').split(' · ')[1] ?? '';
              const how =
                action === 'REVOKED'
                  ? (METHOD_LABELS[(event.method as string) ?? ''] ??
                    (event.method as string))
                  : (SOURCE_LABELS[(event.source as string) ?? ''] ??
                    (event.source as string));
              const actor = (
                (event.createdBy as { name?: string } | null)?.name ?? ''
              ).trim();
              const note = (event.note as string) ?? '';
              const metaParts = [
                how,
                actor,
                formatDateTime(event.occurredAt),
              ].filter((part) => isDefined(part) && part !== '');

              return (
                <StyledHistoryItem key={event.id as string}>
                  <StyledHistoryHead>
                    <StyledHistoryAction $action={action}>
                      {action === 'GRANTED' ? t`Granted` : t`Revoked`}
                    </StyledHistoryAction>
                    <StyledHistoryChannel>
                      {projectLabel
                        ? `${channelLabel} · ${projectLabel}`
                        : channelLabel}
                    </StyledHistoryChannel>
                  </StyledHistoryHead>
                  {metaParts.length > 0 && (
                    <StyledHistoryMeta>
                      {metaParts.join(' · ')}
                    </StyledHistoryMeta>
                  )}
                  {note !== '' && (
                    <StyledHistoryNote>“{note}”</StyledHistoryNote>
                  )}
                </StyledHistoryItem>
              );
            })}
        </StyledHistory>
      )}
    </StyledContainer>
  );
};
