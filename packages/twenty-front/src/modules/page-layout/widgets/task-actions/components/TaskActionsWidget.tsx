import { useLazyQuery, useMutation } from '@apollo/client/react';
import { styled } from '@linaria/react';
import { useEffect, useState } from 'react';

import { isDefined } from 'twenty-shared/utils';
import { Tag } from 'twenty-ui/components';
import {
  IconBrandWhatsapp,
  IconClock,
  IconDeviceMobile,
  IconExternalLink,
  IconPhone,
  IconSend,
  IconWorld,
  type IconComponent,
} from 'twenty-ui/display';
import { ModalContent, ModalFooter, ModalHeader } from 'twenty-ui/layout';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { currentWorkspaceMemberState } from '@/auth/states/currentWorkspaceMemberState';
import { useCreateOneRecord } from '@/object-record/hooks/useCreateOneRecord';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useFindOneRecord } from '@/object-record/hooks/useFindOneRecord';
import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { type PageLayoutWidget } from '@/page-layout/types/PageLayoutWidget';
import { SEND_RECORD_SMS } from '@/settings/notifications/graphql/mutations/sendRecordSms';
import { SEND_TASK_SMS } from '@/settings/notifications/graphql/mutations/sendTaskSms';
import { SEND_TASK_TO_MY_PHONE } from '@/settings/notifications/graphql/mutations/sendTaskToMyPhone';
import { RECORD_SMS_CONTEXT } from '@/settings/notifications/graphql/queries/recordSmsContext';
import { TASK_SMS_CONTEXT } from '@/settings/notifications/graphql/queries/taskSmsContext';
import { TextArea } from '@/ui/input/components/TextArea';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { useLayoutRenderingContext } from '@/ui/layout/contexts/LayoutRenderingContext';
import { ModalStatefulWrapper } from '@/ui/layout/modal/components/ModalStatefulWrapper';
import { useModal } from '@/ui/layout/modal/hooks/useModal';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';

const StyledContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[4]};
  max-width: 460px;
  padding: ${themeCssVariables.spacing[3]};
  width: 100%;
`;

const StyledSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledSectionLabel = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledRow = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledTextArea = styled.textarea`
  background: ${themeCssVariables.background.transparent.lighter};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.md};
  min-height: 56px;
  padding: ${themeCssVariables.spacing[2]};
  resize: vertical;
  width: 100%;
`;

const StyledFootnote = styled.div`
  border-top: 1px solid ${themeCssVariables.border.color.light};
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
  padding-top: ${themeCssVariables.spacing[2]};
`;

const StyledModalTitle = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.md};
  font-weight: 500;
`;

const StyledModalBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  width: 100%;
`;

const StyledModalNote = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledModalBlocked = styled.div`
  color: ${themeCssVariables.color.red};
  font-size: ${themeCssVariables.font.size.sm};
`;

// The widget asks the manager only for what the system can't see: the disposition
// of a touch, and anything done off our infrastructure. On-system actions that need
// telephony / messaging integrations are shown as `soon`. Off-system actions are
// native deep-links built from the linked person's phone / social profile.
// A plain off-system call can't report its duration, so "Call manually" starts a
// CRM-side timer the manager stops on return — that timed duration is logged.
// See docs/logging-architecture.md.

type LinkContext = {
  phoneE164?: string;
  phoneDigits?: string;
  socialUrl?: string;
  greeting?: string;
};

type ActionConfig = {
  label: string;
  Icon: IconComponent;
  soon?: boolean;
  startsTimer?: boolean;
  loggedVia?: string;
  opensComposer?: boolean;
  buildHref?: (context: LinkContext) => string | undefined;
};

// The SMS sender alias is no longer chosen here — it's resolved server-side from
// the deal's project (project.smsAlias) and gated on the lead's SMS consent for
// that project, so a manager can't send under a brand the lead didn't agree to.
// The compose modal just shows the determined alias (read-only).

const SMS_MODAL_ID = 'task-actions-sms-compose';

type ChannelSurface = {
  onSystem: ActionConfig[];
  offSystem: ActionConfig[];
  onSystemLabel?: string;
  offSystemLabel?: string;
  outcomes: string[];
  waitingStatus?: string;
  dealDispositionNote?: boolean;
};

type PersonForLinks = {
  name?: { firstName?: string } | null;
  phones?: {
    primaryPhoneNumber?: string;
    primaryPhoneCallingCode?: string;
  } | null;
  instagramLink?: { primaryLinkUrl?: string } | null;
  facebookLink?: { primaryLinkUrl?: string } | null;
};

// Task outcome = reachability only (drives cadence + advance to Connected).
// Deal disposition (not interested / bought elsewhere) lives on the deal, not here.
const OUTCOME_LABELS: Record<string, string> = {
  REACHED: 'Reached',
  NO_ANSWER: 'No answer',
  BUSY: 'Busy',
  VOICEMAIL: 'Voicemail',
  WRONG_NUMBER: 'Wrong number',
  CALLBACK_REQUESTED: 'Callback set',
};

const CALL_OUTCOMES = [
  'REACHED',
  'NO_ANSWER',
  'BUSY',
  'VOICEMAIL',
  'WRONG_NUMBER',
  'CALLBACK_REQUESTED',
];
const MESSAGE_OUTCOMES = ['REACHED', 'NO_ANSWER'];

// Object mode (logging a touch from a deal/contact record, no task): the manager
// picks the channel — clicking it IS the channel choice — then the matching
// channel surface (deep-links / SMS composer / outcomes) renders below.
const OBJECT_MODE_CHANNELS: {
  label: string;
  value: string;
  Icon: IconComponent;
}[] = [
  { label: 'Call', value: 'CALL', Icon: IconPhone },
  { label: 'WhatsApp', value: 'WHATSAPP', Icon: IconBrandWhatsapp },
  { label: 'SMS', value: 'SMS', Icon: IconSend },
  { label: 'Social', value: 'SOCIAL', Icon: IconExternalLink },
];

const telHref = (context: LinkContext) =>
  isDefined(context.phoneE164) ? `tel:${context.phoneE164}` : undefined;

const formatDuration = (totalSeconds: number) => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const getChannelSurface = (
  channel: string | null | undefined,
): ChannelSurface => {
  switch (channel) {
    case 'CALL':
      return {
        onSystemLabel: 'On system · contact, duration & recording captured',
        onSystem: [
          { label: 'Call from web', Icon: IconWorld, soon: true },
          { label: 'Request callback', Icon: IconPhone, soon: true },
        ],
        offSystemLabel: 'Off system · you dial, we time it, then log it',
        offSystem: [
          {
            label: 'Call manually',
            Icon: IconDeviceMobile,
            startsTimer: true,
            loggedVia: 'MANUAL_LOG',
            buildHref: telHref,
          },
        ],
        outcomes: CALL_OUTCOMES,
        dealDispositionNote: true,
      };
    case 'WHATSAPP':
      return {
        onSystemLabel: 'On system · corporate number, two-way & observed',
        onSystem: [
          { label: 'Open corporate chat', Icon: IconBrandWhatsapp, soon: true },
        ],
        offSystemLabel: 'Off system · personal phone, log it',
        offSystem: [
          {
            label: 'Open on phone',
            Icon: IconDeviceMobile,
            buildHref: (context) =>
              isDefined(context.phoneDigits)
                ? `https://wa.me/${context.phoneDigits}${
                    isDefined(context.greeting)
                      ? `?text=${encodeURIComponent(context.greeting)}`
                      : ''
                  }`
                : undefined,
          },
        ],
        outcomes: MESSAGE_OUTCOMES,
        waitingStatus: 'Waiting for reply',
      };
    case 'SMS':
      return {
        onSystemLabel: 'On system · gateway, one-way (sent via ARTIMA)',
        onSystem: [
          { label: 'Send corporate SMS', Icon: IconSend, opensComposer: true },
        ],
        offSystemLabel: 'Off system · sent from your phone, log it',
        offSystem: [
          {
            label: 'Send manually',
            Icon: IconDeviceMobile,
            buildHref: (context) =>
              isDefined(context.phoneE164)
                ? `sms:${context.phoneE164}`
                : undefined,
          },
        ],
        outcomes: MESSAGE_OUTCOMES,
      };
    case 'SOCIAL':
      return {
        onSystem: [
          {
            label: 'Open conversation',
            Icon: IconExternalLink,
            buildHref: (context) => context.socialUrl,
          },
        ],
        offSystem: [],
        outcomes: MESSAGE_OUTCOMES,
        waitingStatus: 'Waiting for reply',
      };
    default:
      return {
        onSystem: [],
        offSystem: [],
        outcomes: MESSAGE_OUTCOMES,
      };
  }
};

const buildLinkContext = (person: PersonForLinks | undefined): LinkContext => {
  const callingCode = person?.phones?.primaryPhoneCallingCode ?? '';
  const number = person?.phones?.primaryPhoneNumber ?? '';
  const hasNumber = number !== '';
  const e164 = hasNumber
    ? `${callingCode}${number}`.replace(/[^\d+]/g, '')
    : undefined;
  const digits = isDefined(e164) ? e164.replace(/\D/g, '') : undefined;
  const socialUrl =
    person?.instagramLink?.primaryLinkUrl ??
    person?.facebookLink?.primaryLinkUrl;
  const firstName = person?.name?.firstName ?? '';

  return {
    phoneE164: e164,
    phoneDigits: digits,
    socialUrl: isDefined(socialUrl) && socialUrl !== '' ? socialUrl : undefined,
    greeting: firstName !== '' ? `Hi ${firstName}, ` : undefined,
  };
};

type TaskActionsWidgetProps = {
  widget: PageLayoutWidget;
};

export const TaskActionsWidget = ({
  widget: _widget,
}: TaskActionsWidgetProps) => {
  const { targetRecordIdentifier } = useLayoutRenderingContext();
  const recordId = targetRecordIdentifier?.id;
  const objectNameSingular = targetRecordIdentifier?.targetObjectNameSingular;
  // Task mode = the action surface on a sequence/manual task (channel known).
  // Object mode = the same surface on a deal record, where the manager picks the
  // channel and the touch is logged against the deal + its point-of-contact.
  const isTaskMode = objectNameSingular === 'task';
  const isOpportunityMode = objectNameSingular === 'opportunity';

  const taskId = isTaskMode ? recordId : undefined;

  const currentWorkspaceMember = useAtomStateValue(currentWorkspaceMemberState);
  const { updateOneRecord } = useUpdateOneRecord();
  const { createOneRecord: createOutboundActivity } = useCreateOneRecord({
    objectNameSingular: 'outboundActivity',
  });

  const { record: task } = useFindOneRecord({
    objectNameSingular: 'task',
    objectRecordId: taskId,
    skip: !isDefined(taskId),
  });

  // Task mode: resolve the deal + person from the task's taskTarget pins
  // (reliable) — the nested task.sequenceRun.opportunityId is not returned by the
  // record fetch, which is why earlier manual logs landed orphaned from their deal.
  const { records: taskTargets } = useFindManyRecords({
    objectNameSingular: 'taskTarget',
    filter: { taskId: { eq: taskId } },
    recordGqlFields: {
      id: true,
      targetOpportunityId: true,
      targetPersonId: true,
    },
    skip: !isDefined(taskId),
  });

  // Object mode (opportunity): the record IS the deal; the contact is its
  // point-of-contact.
  const opportunityRecordId = isOpportunityMode ? recordId : undefined;
  const { record: opportunityRecord } = useFindOneRecord({
    objectNameSingular: 'opportunity',
    objectRecordId: opportunityRecordId,
    recordGqlFields: { id: true, name: true, pointOfContactId: true },
    skip: !isDefined(opportunityRecordId),
  });

  const opportunityId = isTaskMode
    ? (taskTargets?.find((target) => isDefined(target.targetOpportunityId))
        ?.targetOpportunityId as string | undefined)
    : (opportunityRecordId ?? undefined);
  const personId = isTaskMode
    ? (taskTargets?.find((target) => isDefined(target.targetPersonId))
        ?.targetPersonId as string | undefined)
    : ((opportunityRecord as { pointOfContactId?: string } | undefined)
        ?.pointOfContactId ?? undefined);

  const { record: person } = useFindOneRecord({
    objectNameSingular: 'person',
    objectRecordId: personId,
    skip: !isDefined(personId),
  });

  // Per-manager capability: only members with a recording-capable corporate GSM
  // get the on-system "Call from corporate GSM" action.
  const currentMemberId = currentWorkspaceMember?.id;
  const { record: memberRecord } = useFindOneRecord({
    objectNameSingular: 'workspaceMember',
    objectRecordId: currentMemberId,
    recordGqlFields: { id: true, hasRecordingGsm: true },
    skip: !isDefined(currentMemberId),
  });
  const hasRecordingGsm =
    (memberRecord as { hasRecordingGsm?: boolean } | undefined)
      ?.hasRecordingGsm === true;

  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();
  const [sendTaskToMyPhone, { loading: isSendingToPhone }] = useMutation<{
    sendTaskToMyPhone: { success: boolean; error?: string | null };
  }>(SEND_TASK_TO_MY_PHONE);
  const [sendTaskSms, { loading: isSendingTaskSms }] = useMutation<{
    sendTaskSms: { success: boolean; error?: string | null };
  }>(SEND_TASK_SMS);
  const [sendRecordSms, { loading: isSendingRecordSms }] = useMutation<{
    sendRecordSms: { success: boolean; error?: string | null };
  }>(SEND_RECORD_SMS);
  const isSendingSms = isSendingTaskSms || isSendingRecordSms;

  // Corporate-SMS compose modal: type the message and send. The sender alias +
  // whether sending is allowed come from the server (deal's project + consent).
  const { openModal, closeModal } = useModal();
  const [smsMessage, setSmsMessage] = useState('');
  type SmsContextShape = {
    alias: string | null;
    canSend: boolean;
    reason: string | null;
  };
  const [
    fetchTaskSmsContext,
    { data: taskSmsContextData, loading: isLoadingTaskSmsContext },
  ] = useLazyQuery<{ taskSmsContext: SmsContextShape }>(TASK_SMS_CONTEXT, {
    fetchPolicy: 'network-only',
  });
  const [
    fetchRecordSmsContext,
    { data: recordSmsContextData, loading: isLoadingRecordSmsContext },
  ] = useLazyQuery<{ recordSmsContext: SmsContextShape }>(RECORD_SMS_CONTEXT, {
    fetchPolicy: 'network-only',
  });
  const smsContext = isTaskMode
    ? taskSmsContextData?.taskSmsContext
    : recordSmsContextData?.recordSmsContext;
  const isLoadingSmsContext = isTaskMode
    ? isLoadingTaskSmsContext
    : isLoadingRecordSmsContext;

  // Object mode: the manager picks the channel (it's implied by the action they
  // click); task mode takes the channel from the task itself.
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);

  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  // The selected outcome stays highlighted; reflects the task's saved outcome
  // until the manager picks another (we no longer auto-close the task).
  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null);
  const [pendingLoggedVia, setPendingLoggedVia] =
    useState<string>('MANUAL_LOG');
  // Manual call timer: a plain off-system call reports no duration, so we time it
  // CRM-side from "Call manually" until the manager hits Stop.
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [callDurationS, setCallDurationS] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const activeOutcome =
    selectedOutcome ?? (task?.outcome as string | null | undefined) ?? null;

  const isTiming = isDefined(callStartedAt) && !isDefined(callDurationS);

  useEffect(() => {
    if (!isTiming) {
      return;
    }
    const intervalId = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(intervalId);
  }, [isTiming]);

  const channel = isTaskMode
    ? ((task?.channel as string | null | undefined) ?? null)
    : selectedChannel;
  const surface = getChannelSurface(channel);
  const linkContext = buildLinkContext(person as PersonForLinks | undefined);

  // The corporate-GSM call is on-system (the recording SIM captures both ways) but
  // dials via a plain tel: — gated to capable managers, marked CORPORATE_GSM so a
  // synced recording can attach later.
  const onSystemActions: ActionConfig[] =
    channel === 'CALL' && hasRecordingGsm
      ? [
          {
            // Recorded two-way → no manual timer; duration comes from the recording.
            label: 'Call from corporate GSM',
            Icon: IconDeviceMobile,
            loggedVia: 'CORPORATE_GSM',
            buildHref: telHref,
          },
          ...surface.onSystem,
        ]
      : surface.onSystem;

  const elapsedSeconds = isDefined(callDurationS)
    ? callDurationS
    : isDefined(callStartedAt)
      ? Math.floor((now - callStartedAt) / 1000)
      : 0;

  // Hand off to the OS via a native anchor click. window.open(tel:) closes the
  // page on mobile and trips the desktop popup blocker; a tel:/sms: anchor with
  // no target invokes the dialer/Messages without navigating away, and web links
  // (wa.me / social) open in a new tab.
  const handleOpen = (href: string | undefined) => {
    if (!isDefined(href)) {
      return;
    }
    const anchor = document.createElement('a');

    anchor.href = href;
    anchor.rel = 'noopener noreferrer';

    if (!href.startsWith('tel:') && !href.startsWith('sms:')) {
      anchor.target = '_blank';
    }
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  // One handler for every action button: open the deep-link, tag how the touch
  // is being logged, and (only for the plain off-system call) start the timer.
  // Corporate GSM does NOT time — its duration comes from the recording.
  const handleActionClick = (action: ActionConfig) => {
    if (action.opensComposer === true) {
      setSmsMessage(linkContext.greeting ?? '');
      // Refresh consent + the project's alias each time the modal opens.
      if (isTaskMode && isDefined(taskId)) {
        fetchTaskSmsContext({ variables: { taskId } });
      } else if (!isTaskMode) {
        fetchRecordSmsContext({
          variables: {
            opportunityId: opportunityId ?? null,
            personId: personId ?? null,
          },
        });
      }
      openModal(SMS_MODAL_ID);

      return;
    }

    handleOpen(action.buildHref?.(linkContext));

    if (isDefined(action.loggedVia)) {
      setPendingLoggedVia(action.loggedVia);
    }

    if (action.startsTimer === true) {
      setCallDurationS(null);
      setCallStartedAt(Date.now());
      setNow(Date.now());
    }
  };

  const handleSendSms = async () => {
    if (
      smsMessage.trim() === '' ||
      isSendingSms ||
      smsContext?.canSend !== true
    ) {
      return;
    }

    let outcome: { success: boolean; error?: string | null } | undefined;

    if (isTaskMode) {
      if (!isDefined(taskId)) {
        return;
      }
      const result = await sendTaskSms({
        variables: { taskId, message: smsMessage },
      });

      outcome = result.data?.sendTaskSms;
    } else {
      const result = await sendRecordSms({
        variables: {
          opportunityId: opportunityId ?? null,
          personId: personId ?? null,
          message: smsMessage,
        },
      });

      outcome = result.data?.sendRecordSms;
    }

    if (outcome?.success === true) {
      enqueueSuccessSnackBar({ message: 'SMS sent' });
      closeModal(SMS_MODAL_ID);
      setSmsMessage('');
    } else {
      enqueueErrorSnackBar({
        message: outcome?.error ?? 'Could not send the SMS',
      });
    }
  };

  const handleStopCall = () => {
    if (isDefined(callStartedAt)) {
      setCallDurationS(
        Math.max(1, Math.floor((Date.now() - callStartedAt) / 1000)),
      );
    }
  };

  const handleContinueOnPhone = async () => {
    if (!isDefined(taskId)) {
      return;
    }
    const result = await sendTaskToMyPhone({ variables: { taskId } });
    const outcome = result.data?.sendTaskToMyPhone;

    if (outcome?.success === true) {
      enqueueSuccessSnackBar({ message: 'Sent to your phone' });
    } else {
      enqueueErrorSnackBar({
        message: outcome?.error ?? 'Could not send to your phone',
      });
    }
  };

  const handleLog = async (outcome: string) => {
    if (isSaving) {
      return;
    }
    // Need a target to log against: a task (task mode) or a deal/person (object).
    if (isTaskMode ? !isDefined(taskId) : !isDefined(personId)) {
      return;
    }

    // Record the outcome; do NOT auto-close — the manager closes the task when
    // they're done. The clicked outcome stays highlighted.
    setSelectedOutcome(outcome);
    setIsSaving(true);

    try {
      await createOutboundActivity({
        ...(isDefined(channel) ? { channel } : {}),
        loggedVia: pendingLoggedVia,
        body: notes,
        occurredAt: new Date().toISOString(),
        ...(isDefined(taskId) ? { taskId } : {}),
        ...(isDefined(callDurationS) ? { durationS: callDurationS } : {}),
        ...(isDefined(opportunityId) ? { opportunityId } : {}),
        ...(isDefined(personId) ? { personId } : {}),
        ...(isDefined(currentWorkspaceMember?.id)
          ? { performedById: currentWorkspaceMember.id }
          : {}),
      });

      // Task mode also stamps the task's reachability outcome.
      if (isTaskMode && isDefined(taskId)) {
        await updateOneRecord({
          objectNameSingular: 'task',
          idToUpdate: taskId,
          updateOneRecordInput: { outcome },
        });
      }

      setNotes('');
      setCallStartedAt(null);
      setCallDurationS(null);
      setPendingLoggedVia('MANUAL_LOG');
    } finally {
      setIsSaving(false);
    }
  };

  const renderAction = (action: ActionConfig, isPrimary: boolean) => {
    const href = action.buildHref?.(linkContext);
    const isDeepLink = isDefined(action.buildHref);
    const isClickable = isDeepLink || action.opensComposer === true;
    const isDisabled = action.soon === true || (isDeepLink && !isDefined(href));

    const onClick = isClickable ? () => handleActionClick(action) : undefined;

    return (
      <Button
        key={action.label}
        title={action.label}
        Icon={action.Icon}
        variant={isPrimary ? 'primary' : 'secondary'}
        accent={isPrimary ? 'blue' : 'default'}
        soon={action.soon}
        disabled={isDisabled}
        onClick={onClick}
      />
    );
  };

  const hasTimer = isDefined(callStartedAt) || isDefined(callDurationS);
  // Object mode shows nothing until a channel is chosen; task mode always shows.
  const surfaceVisible = isTaskMode || isDefined(selectedChannel);

  const handleSelectChannel = (value: string) => {
    setSelectedChannel(value);
    setSelectedOutcome(null);
    setCallStartedAt(null);
    setCallDurationS(null);
    setPendingLoggedVia('MANUAL_LOG');
  };

  return (
    <StyledContainer>
      {!isTaskMode && (
        <StyledSection>
          <StyledSectionLabel>
            {isDefined(personId)
              ? 'Log a touch — pick the channel'
              : 'No point-of-contact on this deal yet'}
          </StyledSectionLabel>
          <StyledRow>
            {OBJECT_MODE_CHANNELS.map((option) => (
              <Button
                key={option.value}
                title={option.label}
                Icon={option.Icon}
                variant={
                  selectedChannel === option.value ? 'primary' : 'secondary'
                }
                accent={selectedChannel === option.value ? 'blue' : 'default'}
                disabled={!isDefined(personId)}
                onClick={() => handleSelectChannel(option.value)}
              />
            ))}
          </StyledRow>
        </StyledSection>
      )}

      {surfaceVisible && (
        <>
          {onSystemActions.length > 0 && (
            <StyledSection>
              {isDefined(surface.onSystemLabel) && (
                <StyledSectionLabel>{surface.onSystemLabel}</StyledSectionLabel>
              )}
              <StyledRow>
                {onSystemActions.map((action) => renderAction(action, true))}
              </StyledRow>
            </StyledSection>
          )}

          {surface.offSystem.length > 0 && (
            <StyledSection>
              {isDefined(surface.offSystemLabel) && (
                <StyledSectionLabel>
                  {surface.offSystemLabel}
                </StyledSectionLabel>
              )}
              <StyledRow>
                {surface.offSystem.map((action) => renderAction(action, false))}
              </StyledRow>
            </StyledSection>
          )}

          {hasTimer && (
            <StyledRow>
              {isTiming ? (
                <>
                  <Tag
                    color="blue"
                    text={`On call · ${formatDuration(elapsedSeconds)}`}
                    Icon={IconClock}
                  />
                  <Button
                    title="Stop"
                    variant="secondary"
                    onClick={handleStopCall}
                  />
                </>
              ) : (
                <StyledSectionLabel>
                  {`Call timed at ${formatDuration(elapsedSeconds)} — pick the outcome to log it.`}
                </StyledSectionLabel>
              )}
            </StyledRow>
          )}

          {isDefined(surface.waitingStatus) && (
            <Tag color="orange" text={surface.waitingStatus} Icon={IconClock} />
          )}

          <StyledSection>
            <StyledSectionLabel>
              Log what happened on this touch
            </StyledSectionLabel>
            <StyledTextArea
              placeholder="Notes (what you said, what they wanted)…"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
            <StyledRow>
              {surface.outcomes.map((outcome) => {
                const isSelected = activeOutcome === outcome;

                return (
                  <Button
                    key={outcome}
                    title={OUTCOME_LABELS[outcome] ?? outcome}
                    variant={isSelected ? 'primary' : 'secondary'}
                    accent={isSelected ? 'blue' : 'default'}
                    disabled={isSaving}
                    onClick={() => handleLog(outcome)}
                  />
                );
              })}
            </StyledRow>
          </StyledSection>

          {surface.dealDispositionNote === true && (
            <StyledFootnote>
              Deal outcome (not interested / bought elsewhere) is set on the
              deal, separately — it isn't a task action.
            </StyledFootnote>
          )}

          {isTaskMode && (
            <StyledRow>
              <Button
                title="Continue on phone"
                Icon={IconDeviceMobile}
                variant="secondary"
                disabled={isSendingToPhone}
                onClick={handleContinueOnPhone}
              />
            </StyledRow>
          )}
        </>
      )}

      <ModalStatefulWrapper
        modalInstanceId={SMS_MODAL_ID}
        size="small"
        padding="medium"
        isClosable
      >
        <ModalHeader>
          <StyledModalTitle>Send corporate SMS</StyledModalTitle>
        </ModalHeader>
        <ModalContent>
          <StyledModalBody>
            <TextArea
              textAreaId="task-sms-message"
              placeholder="Message to send…"
              value={smsMessage}
              onChange={setSmsMessage}
              minRows={3}
            />
            {isLoadingSmsContext ? (
              <StyledModalNote>Checking consent…</StyledModalNote>
            ) : smsContext?.canSend === true ? (
              <StyledModalNote>Sending as {smsContext.alias}</StyledModalNote>
            ) : (
              <StyledModalBlocked>
                {smsContext?.reason ?? 'This SMS can’t be sent.'}
              </StyledModalBlocked>
            )}
          </StyledModalBody>
        </ModalContent>
        <ModalFooter>
          <Button
            title="Cancel"
            variant="secondary"
            onClick={() => closeModal(SMS_MODAL_ID)}
          />
          <Button
            title="Send"
            variant="primary"
            accent="blue"
            disabled={
              isSendingSms ||
              smsMessage.trim() === '' ||
              smsContext?.canSend !== true
            }
            onClick={handleSendSms}
          />
        </ModalFooter>
      </ModalStatefulWrapper>
    </StyledContainer>
  );
};
