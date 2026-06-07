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
// by default; an explicit Edit mode enables changes. Every change (grant, opt-out
// and adding a project) is confirm-first via a centered modal — cancelling writes
// nothing. The read-only audit trail lives in its own "Consent" tab
// (PersonConsentHistory). Per person × project.
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

// Grant sources a manager can pick (the "how obtained"). Automated sources
// (FORM_WEBSITE/LEAD_AD) come from the pipeline, not this card.
const GRANT_SOURCES = [
  { value: 'VERBAL', label: 'Verbal (call)' },
  { value: 'IN_CHAT', label: 'Written (chat/DM)' },
  { value: 'WALK_IN', label: 'Walk-in' },
  { value: 'REFERRAL', label: 'Referral' },
  { value: 'MANUAL', label: 'Manual' },
] as const;

// How a manual opt-out happened (the event log's `method`).
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

const StyledNoteInput = styled.input`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
  width: 100%;
`;

const StyledActions = styled.div`
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

// Centered, full-page modal (portal to <body>) — every change is confirmed here,
// so it's unmissable regardless of where the card sits or how the page scrolls.
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

export const PersonConsentCard = () => {
  const { t } = useLingui();
  const { targetRecordIdentifier } = useLayoutRenderingContext();
  const personId = targetRecordIdentifier?.id;
  const isPerson =
    targetRecordIdentifier?.targetObjectNameSingular === 'person';

  const [addProjectId, setAddProjectId] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);

  // Single-channel grant/opt-out, captured before it is applied (modal open).
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

  // Confirm-first "add a project" — nothing is created until the modal confirms.
  const [addModal, setAddModal] = useState<{
    projectId: string;
    projectLabel: string;
    channels: { key: string; label: string }[];
  } | null>(null);

  // Shared multi-channel modal state (add + auto contact-check).
  const [modalSource, setModalSource] = useState('VERBAL');
  const [modalNote, setModalNote] = useState('');
  const [deselected, setDeselected] = useState<Set<string>>(new Set());

  // Per-session "don't ask again" for the auto contact-check modal — NOT a
  // consent state, just suppresses the nudge until next login.
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
  const reachableChannels = CHANNELS.filter((channel) =>
    hasContactFor(channel.contact),
  );

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

      return {
        state: 'on',
        text: date ? `${sourceLabel} · ${date}` : sourceLabel,
      };
    }

    if (isDefined(revokedAt)) {
      const date = formatDate(revokedAt);

      return {
        state: 'off',
        text: date ? t`Opted out · ${date}` : t`Opted out`,
      };
    }

    if (hasContactFor(contact)) {
      return { state: 'notProvided', text: t`Not provided` };
    }

    return { state: 'none', text: t`Not set` };
  };

  const notProvidedChannels = (consent: Record<string, unknown>) =>
    CHANNELS.filter(
      (channel) =>
        channelState(consent, channel.key, channel.contact).state ===
        'notProvided',
    );

  // ---- single-channel grant / opt-out (modal) ----
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
    setPendingChoice(isOn ? 'MANUAL' : 'VERBAL');
    setPendingNote('');
  };

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

  // ---- shared multi-channel modal helpers ----
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

  const resetModalInputs = () => {
    setModalSource('VERBAL');
    setModalNote('');
    setDeselected(new Set());
  };

  // ---- confirm-first add a project ----
  const openAddModal = () => {
    if (addProjectId === '' || consentedProjectIds.has(addProjectId)) {
      return;
    }
    const project = projects.find((item) => item.id === addProjectId);

    resetModalInputs();
    setAddModal({
      projectId: addProjectId,
      projectLabel: (project?.name as string) ?? t`this project`,
      channels: reachableChannels.map((channel) => ({
        key: channel.key,
        label: channel.label,
      })),
    });
  };

  const cancelAddModal = () => {
    setAddModal(null);
    setAddProjectId('');
    resetModalInputs();
  };

  const confirmAddModal = async () => {
    if (!isDefined(addModal) || saving) {
      return;
    }
    const selected = addModal.channels.filter(
      (channel) => !deselected.has(channel.key),
    );
    const note = modalNote.trim();
    const input: Record<string, unknown> = {
      personId,
      projectId: addModal.projectId,
    };
    for (const channel of selected) {
      input[`${channel.key}MarketingConsent`] = true;
      input[`${channel.key}MarketingConsentSource`] = modalSource;
    }
    if (note !== '') {
      input.lastChangeReason = note;
    }

    setSaving(true);
    try {
      await createOneRecord(input);
    } finally {
      setSaving(false);
      cancelAddModal();
    }
  };

  // ---- auto contact-check nudge ----
  const consentCheckRow =
    personLoading || loading || isDefined(pending) || isDefined(addModal)
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
    resetModalInputs();
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
      resetModalInputs();
    }
  };

  // The active multi-channel modal — "add a project" takes priority over the
  // auto contact-check nudge.
  const checkProjectLabel = isDefined(consentCheckRow)
    ? (((consentCheckRow.name as string) ?? '').split(' · ')[1] ??
      t`this project`)
    : '';
  const projectModal = isDefined(addModal)
    ? {
        title: t`Record consent for ${addModal.projectLabel}`,
        text: t`Tick the channels they agreed to. Cancel adds nothing.`,
        channels: addModal.channels,
        confirmLabel: t`Add`,
        cancelLabel: t`Cancel`,
        allowEmpty: true,
        onCancel: cancelAddModal,
        onConfirm: confirmAddModal,
      }
    : isDefined(consentCheckRow)
      ? {
          title: t`Consent check`,
          text: t`No marketing consent is on record for ${checkProjectLabel}, but we can reach this person. Tick the channels they agreed to, or choose Not now.`,
          channels: notProvidedChannels(consentCheckRow),
          confirmLabel: t`Record consent`,
          cancelLabel: t`Not now`,
          allowEmpty: false,
          onCancel: () => dismissConsentCheck(consentCheckRow),
          onConfirm: () =>
            recordConsentCheck(
              consentCheckRow,
              notProvidedChannels(consentCheckRow).filter(
                (channel) => !deselected.has(channel.key),
              ),
            ),
        }
      : null;
  const projectModalSelectedCount = isDefined(projectModal)
    ? projectModal.channels.filter((channel) => !deselected.has(channel.key))
        .length
    : 0;

  return (
    <StyledContainer>
      <StyledHeader>
        <StyledHint>
          {editMode
            ? t`Click a channel, then confirm. Cancel writes nothing.`
            : t`Read-only. Click Edit to record verbal consent or an opt-out.`}
        </StyledHint>
        {consents.length > 0 && (
          <StyledEditButton onClick={() => setEditMode((value) => !value)}>
            {editMode ? t`Done` : t`Edit`}
          </StyledEditButton>
        )}
      </StyledHeader>

      {loading ? (
        <StyledHint>{t`Loading…`}</StyledHint>
      ) : (
        consents.map((consent) => {
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
        })
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
          <StyledAddButton onClick={openAddModal} disabled={addProjectId === ''}>
            {t`Add`}
          </StyledAddButton>
        </StyledAddRow>
      )}

      {isDefined(pending) &&
        createPortal(
          <StyledModalOverlay>
            <StyledModalDialog>
              <StyledModalTitle>
                {pending.kind === 'grant'
                  ? t`Grant ${pending.channelLabel} for ${pending.projectLabel}`
                  : t`Opt ${pending.projectLabel} out of ${pending.channelLabel}`}
              </StyledModalTitle>

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
                <StyledModalText>
                  {t`Re-enabling — the original consent source is preserved.`}
                </StyledModalText>
              )}

              <StyledNoteInput
                value={pendingNote}
                placeholder={t`Note / proof (optional)`}
                onChange={(event) => setPendingNote(event.target.value)}
              />

              <StyledActions>
                <StyledCancelButton onClick={cancelPending}>
                  {t`Cancel`}
                </StyledCancelButton>
                <StyledAddButton onClick={confirmPending} disabled={saving}>
                  {pending.kind === 'grant' ? t`Grant` : t`Opt out`}
                </StyledAddButton>
              </StyledActions>
            </StyledModalDialog>
          </StyledModalOverlay>,
          document.body,
        )}

      {isDefined(projectModal) &&
        createPortal(
          <StyledModalOverlay>
            <StyledModalDialog>
              <StyledModalTitle>{projectModal.title}</StyledModalTitle>
              <StyledModalText>{projectModal.text}</StyledModalText>
              {projectModal.channels.length > 0 ? (
                <StyledCheckList>
                  {projectModal.channels.map((channel) => (
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
              ) : (
                <StyledHint>{t`No phone or email on file yet.`}</StyledHint>
              )}
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
              <StyledActions>
                <StyledCancelButton onClick={projectModal.onCancel}>
                  {projectModal.cancelLabel}
                </StyledCancelButton>
                <StyledAddButton
                  onClick={projectModal.onConfirm}
                  disabled={
                    saving ||
                    (!projectModal.allowEmpty && projectModalSelectedCount === 0)
                  }
                >
                  {projectModal.confirmLabel}
                </StyledAddButton>
              </StyledActions>
            </StyledModalDialog>
          </StyledModalOverlay>,
          document.body,
        )}
    </StyledContainer>
  );
};
