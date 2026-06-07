import { isNonEmptyString } from '@sniptt/guards';
import { useLingui } from '@lingui/react/macro';
import { styled } from '@linaria/react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
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

// `contact` says which person field backs the channel: a channel is only
// "Not provided" (we have the means to reach them but no consent) when that
// contact actually exists on the person.
const CHANNELS = [
  { key: 'call', label: 'Call', contact: 'phone' },
  { key: 'sms', label: 'SMS', contact: 'phone' },
  { key: 'whatsapp', label: 'WhatsApp', contact: 'phone' },
  { key: 'email', label: 'Email', contact: 'email' },
] as const;

const DISMISS_PREFIX = 'enso_consent_check_dismissed:';

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

// How a manual opt-out happened (the event log's `method`). Automated methods
// (unsubscribe link / SMS STOP / WhatsApp opt-out) are recorded by automation,
// but a manager may still log them ("customer replied STOP").
const REVOKE_METHODS = [
  { value: 'MANUAL', label: 'Manual (manager)' },
  { value: 'VERBAL_REQUEST', label: 'Verbal/chat request' },
  { value: 'COMPLAINT', label: 'Complaint' },
  { value: 'UNSUBSCRIBE', label: 'Unsubscribe link' },
  { value: 'SMS_STOP', label: 'SMS STOP' },
  { value: 'WHATSAPP_OPTOUT', label: 'WhatsApp opt-out' },
  { value: 'LEGAL_ERASURE', label: 'Legal erasure (GDPR)' },
  { value: 'OTHER', label: 'Other' },
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

// $state: 'on' (granted, green) | 'off' (revoked, danger) | 'notProvided'
// (have contact but no consent, warning orange) | 'none' (no contact, muted).
const StyledStatus = styled.button<{ $state: string; $editable: boolean }>`
  background: transparent;
  border: none;
  color: ${({ $state }) =>
    $state === 'on'
      ? themeCssVariables.color.green
      : $state === 'off'
        ? themeCssVariables.font.color.danger
        : $state === 'notProvided'
          ? themeCssVariables.color.orange
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

const StyledPanel = styled.div`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[2]};
`;

const StyledPanelTitle = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.medium};
`;

const StyledNoteInput = styled.input`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
  width: 100%;
`;

const StyledPanelActions = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: flex-end;
`;

const StyledCancelButton = styled.button`
  background: transparent;
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.secondary};
  cursor: pointer;
  flex: 0 0 auto;
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
`;

// Centered, full-page modal (rendered via portal to <body>) so the consent-check
// nudge is unmissable no matter where the card sits or how the page is scrolled.
const StyledModalOverlay = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.overlayPrimary};
  bottom: 0;
  display: flex;
  justify-content: center;
  left: 0;
  padding: ${themeCssVariables.spacing[4]};
  position: fixed;
  right: 0;
  top: 0;
  z-index: 12000;
`;

const StyledModalDialog = styled.div`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  box-shadow: ${themeCssVariables.boxShadow.strong};
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  max-width: 420px;
  padding: ${themeCssVariables.spacing[4]};
  width: 100%;
`;

const StyledModalTitle = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.md};
  font-weight: ${themeCssVariables.font.weight.semiBold};
`;

const StyledModalText = styled.div`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledCheckList = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
`;

const StyledCheckLabel = styled.label`
  align-items: center;
  color: ${themeCssVariables.font.color.primary};
  cursor: pointer;
  display: flex;
  font-size: ${themeCssVariables.font.size.sm};
  gap: ${themeCssVariables.spacing[2]};
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
  // The in-progress grant/opt-out, captured before it is applied. While set, the
  // panel is open; cancelling clears it and NOTHING is written.
  const [pending, setPending] = useState<{
    consentId: string;
    channelKey: string;
    channelLabel: string;
    projectLabel: string;
    kind: 'grant' | 'revoke';
    neverConsented: boolean;
  } | null>(null);
  const [pendingChoice, setPendingChoice] = useState('');
  const [pendingNote, setPendingNote] = useState('');
  const [saving, setSaving] = useState(false);
  // Per-session "don't ask again" for the consent-check modal (keyed by
  // person:project). Lives in sessionStorage so it survives reloads this session
  // but re-surfaces next login — it is NOT a consent state.
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    const result = new Set<string>();
    if (typeof window !== 'undefined') {
      for (let index = 0; index < window.sessionStorage.length; index++) {
        const key = window.sessionStorage.key(index);
        if (isDefined(key) && key.startsWith(DISMISS_PREFIX)) {
          result.add(key.slice(DISMISS_PREFIX.length));
        }
      }
    }
    return result;
  });
  const [modalSource, setModalSource] = useState('VERBAL');
  const [modalNote, setModalNote] = useState('');
  // Channels the manager UN-ticked in the consent-check modal (default: all the
  // reachable channels are ticked). Lets them grant e.g. phone but not email.
  const [deselected, setDeselected] = useState<Set<string>>(new Set());

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

  // The person's own contact methods decide what "Not provided" means: a channel
  // is only flagged when we actually have a way to reach them on it.
  const { records: persons = [], loading: personLoading } = useFindManyRecords({
    objectNameSingular: 'person',
    filter: { id: { eq: personId } },
    recordGqlFields: { id: true, name: true, emails: true, phones: true },
    skip: !isDefined(personId) || !isPerson,
    limit: 1,
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

  const person = persons[0] as Record<string, unknown> | undefined;
  const hasEmail = isNonEmptyString(
    (person?.emails as { primaryEmail?: string } | undefined)?.primaryEmail,
  );
  const hasPhone = isNonEmptyString(
    (person?.phones as { primaryPhoneNumber?: string } | undefined)
      ?.primaryPhoneNumber,
  );
  const hasContactFor = (contact: 'email' | 'phone') =>
    contact === 'email' ? hasEmail : hasPhone;

  const channelState = (
    consent: Record<string, unknown>,
    key: string,
    contact: 'email' | 'phone',
  ) => {
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

    // We have a way to reach them on this channel but no consent on record —
    // the compliance flag the manager needs to see.
    if (hasContactFor(contact)) {
      return { state: 'notProvided', text: t`Not provided` };
    }

    return { state: 'none', text: t`Not set` };
  };

  // Channels for a project that are "Not provided" right now (drive the modal).
  const notProvidedChannels = (consent: Record<string, unknown>) =>
    CHANNELS.filter(
      (channel) =>
        channelState(consent, channel.key, channel.contact).state ===
        'notProvided',
    );

  // Open the panel for a channel. Writes nothing yet — the manager must confirm.
  const startAction = (
    consent: Record<string, unknown>,
    key: string,
    label: string,
    projectLabel: string,
  ) => {
    const isOn = consent[`${key}MarketingConsent`] === true;
    const neverConsented = !isDefined(consent[`${key}MarketingConsentedAt`]);

    setPending({
      consentId: consent.id as string,
      channelKey: key,
      channelLabel: label,
      projectLabel,
      kind: isOn ? 'revoke' : 'grant',
      neverConsented,
    });
    // Default the dropdown: grants → first source, opt-outs → manual.
    setPendingChoice(isOn ? 'MANUAL' : 'VERBAL');
    setPendingNote('');
  };

  // Cancel — the whole point: clears the panel and NEVER writes a change.
  const cancelPending = () => {
    setPending(null);
    setPendingChoice('');
    setPendingNote('');
  };

  const confirmPending = async () => {
    if (!isDefined(pending) || saving) {
      return;
    }
    const { consentId, channelKey, kind, neverConsented } = pending;
    const note = pendingNote.trim();

    const updateInput: Record<string, unknown> =
      kind === 'revoke'
        ? {
            [`${channelKey}MarketingConsent`]: false,
            lastRevokeMethod: pendingChoice,
            ...(note !== '' ? { lastChangeReason: note } : {}),
          }
        : {
            [`${channelKey}MarketingConsent`]: true,
            // Source is stamped only on a FIRST-EVER grant; the server's
            // provenance guard refuses to overwrite an existing one.
            ...(neverConsented
              ? { [`${channelKey}MarketingConsentSource`]: pendingChoice }
              : {}),
            ...(note !== '' ? { lastChangeReason: note } : {}),
          };

    setSaving(true);
    try {
      await updateOneRecord({
        objectNameSingular: 'personProjectConsent',
        idToUpdate: consentId,
        updateOneRecordInput: updateInput,
        optimisticRecord: {
          [`${channelKey}MarketingConsent`]: kind === 'grant',
        },
      });
    } finally {
      setSaving(false);
      cancelPending();
    }
  };

  const addConsent = async () => {
    if (addProjectId === '' || consentedProjectIds.has(addProjectId)) {
      return;
    }

    // Establish the person × project row only; channels start ungranted and are
    // granted one-by-one through the confirmed panel flow (no silent consent).
    await createOneRecord({
      personId,
      projectId: addProjectId,
    });

    setAddProjectId('');
  };

  // The first project still needing a consent decision (has a reachable contact,
  // nothing recorded) and not dismissed this session — drives the modal nudge.
  const consentCheckRow =
    personLoading || loading || isDefined(pending)
      ? undefined
      : consents.find(
          (consent) =>
            !dismissed.has(`${personId}:${consent.projectId as string}`) &&
            notProvidedChannels(consent).length > 0,
        );

  const dismissConsentCheck = (consent: Record<string, unknown>) => {
    const key = `${personId}:${consent.projectId as string}`;
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(`${DISMISS_PREFIX}${key}`, '1');
    }
    setDismissed((previous) => new Set(previous).add(key));
    setDeselected(new Set());
  };

  const toggleCheckChannel = (channelKey: string) => {
    setDeselected((previous) => {
      const next = new Set(previous);
      if (next.has(channelKey)) {
        next.delete(channelKey);
      } else {
        next.add(channelKey);
      }
      return next;
    });
  };

  const recordConsentCheck = async (
    consent: Record<string, unknown>,
    channels: readonly { key: string; label: string }[],
  ) => {
    if (saving) {
      return;
    }
    const note = modalNote.trim();
    const updateInput: Record<string, unknown> = {};
    for (const channel of channels) {
      updateInput[`${channel.key}MarketingConsent`] = true;
      updateInput[`${channel.key}MarketingConsentSource`] = modalSource;
    }
    if (note !== '') {
      updateInput.lastChangeReason = note;
    }

    setSaving(true);
    try {
      await updateOneRecord({
        objectNameSingular: 'personProjectConsent',
        idToUpdate: consent.id as string,
        updateOneRecordInput: updateInput,
      });
    } finally {
      setSaving(false);
      setModalNote('');
      setDeselected(new Set());
    }
  };

  const checkChannels = isDefined(consentCheckRow)
    ? notProvidedChannels(consentCheckRow)
    : [];
  const checkProjectLabel = isDefined(consentCheckRow)
    ? (((consentCheckRow.name as string) ?? '').split(' · ')[1] ??
      t`this project`)
    : '';
  const checkSelected = checkChannels.filter(
    (channel) => !deselected.has(channel.key),
  );

  return (
    <StyledContainer>
      <StyledHeader>
        <StyledHint>
          {editMode
            ? t`Click a channel, then confirm. Granting keeps any existing form consent; cancel writes nothing.`
            : t`Read-only. Click Edit to record verbal consent or an opt-out.`}
        </StyledHint>
        {consents.length > 0 && (
          <StyledEditButton onClick={() => setEditMode((value) => !value)}>
            {editMode ? t`Done` : t`Edit`}
          </StyledEditButton>
        )}
      </StyledHeader>

      {isDefined(pending) && (
        <StyledPanel>
          <StyledPanelTitle>
            {pending.kind === 'grant'
              ? t`Grant ${pending.channelLabel} for ${pending.projectLabel}`
              : t`Opt ${pending.projectLabel} out of ${pending.channelLabel}`}
          </StyledPanelTitle>

          {pending.kind === 'revoke' ? (
            <StyledSelect
              value={pendingChoice}
              onChange={(event) => setPendingChoice(event.target.value)}
            >
              {REVOKE_METHODS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </StyledSelect>
          ) : pending.neverConsented ? (
            <StyledSelect
              value={pendingChoice}
              onChange={(event) => setPendingChoice(event.target.value)}
            >
              {GRANT_SOURCES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </StyledSelect>
          ) : (
            <StyledHint>
              {t`Re-enabling — the original consent source is preserved.`}
            </StyledHint>
          )}

          <StyledNoteInput
            value={pendingNote}
            placeholder={t`Note / proof (optional)`}
            onChange={(event) => setPendingNote(event.target.value)}
          />

          <StyledPanelActions>
            <StyledCancelButton onClick={cancelPending}>
              {t`Cancel`}
            </StyledCancelButton>
            <StyledAddButton onClick={confirmPending} disabled={saving}>
              {pending.kind === 'grant' ? t`Grant` : t`Opt out`}
            </StyledAddButton>
          </StyledPanelActions>
        </StyledPanel>
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
                  const { state, text } = channelState(
                    consent,
                    channel.key,
                    channel.contact,
                  );

                  return (
                    <StyledChannelLine key={channel.key}>
                      <StyledChannelLabel>{channel.label}</StyledChannelLabel>
                      <StyledStatus
                        $state={state}
                        $editable={editMode}
                        onClick={() =>
                          editMode &&
                          startAction(
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

      {isDefined(consentCheckRow) &&
        checkChannels.length > 0 &&
        createPortal(
          <StyledModalOverlay>
            <StyledModalDialog>
              <StyledModalTitle>{t`Consent check`}</StyledModalTitle>
              <StyledModalText>
                {t`No marketing consent is on record for ${checkProjectLabel}, but we can reach this person. Tick the channels they agreed to, or choose Not now.`}
              </StyledModalText>
              <StyledCheckList>
                {checkChannels.map((channel) => (
                  <StyledCheckLabel key={channel.key}>
                    <input
                      type="checkbox"
                      checked={!deselected.has(channel.key)}
                      onChange={() => toggleCheckChannel(channel.key)}
                    />
                    {channel.label}
                  </StyledCheckLabel>
                ))}
              </StyledCheckList>
              <StyledSelect
                value={modalSource}
                onChange={(event) => setModalSource(event.target.value)}
              >
                {GRANT_SOURCES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </StyledSelect>
              <StyledNoteInput
                value={modalNote}
                placeholder={t`Note / proof (optional)`}
                onChange={(event) => setModalNote(event.target.value)}
              />
              <StyledPanelActions>
                <StyledCancelButton
                  onClick={() => dismissConsentCheck(consentCheckRow)}
                >
                  {t`Not now`}
                </StyledCancelButton>
                <StyledAddButton
                  onClick={() =>
                    recordConsentCheck(consentCheckRow, checkSelected)
                  }
                  disabled={saving || checkSelected.length === 0}
                >
                  {t`Record consent`}
                </StyledAddButton>
              </StyledPanelActions>
            </StyledModalDialog>
          </StyledModalOverlay>,
          document.body,
        )}
    </StyledContainer>
  );
};
