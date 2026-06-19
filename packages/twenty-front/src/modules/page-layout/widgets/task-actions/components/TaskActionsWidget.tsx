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
import { SEND_PERSON_SMS } from '@/settings/notifications/graphql/mutations/sendPersonSms';
import { SEND_TASK_SMS } from '@/settings/notifications/graphql/mutations/sendTaskSms';
import { SEND_TASK_TO_MY_PHONE } from '@/settings/notifications/graphql/mutations/sendTaskToMyPhone';
import { PERSON_SMS_CONTEXT } from '@/settings/notifications/graphql/queries/personSmsContext';
import { TASK_SMS_CONTEXT } from '@/settings/notifications/graphql/queries/taskSmsContext';
import { Select } from '@/ui/input/components/Select';
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
        onSystemLabel:
          'On system · SMS gateway, one-way (sent under the consented brand)',
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
  // Optional: the page-layout renderer passes the widget config, but the global
  // "Log activity" launcher hosts this surface with no page-layout widget.
  widget?: PageLayoutWidget;
};

export const TaskActionsWidget = ({
  widget: _widget,
}: TaskActionsWidgetProps = {}) => {
  const { targetRecordIdentifier } = useLayoutRenderingContext();
  const recordId = targetRecordIdentifier?.id;
  const objectNameSingular = targetRecordIdentifier?.targetObjectNameSingular;
  // Task mode = the action surface on a sequence/manual task (channel known).
  // Object mode = the same surface on a deal/person/company record, where the
  // manager picks the channel (and, off a person/company, the deal/contact) and
  // the touch is logged against that deal + contact.
  const isTaskMode = objectNameSingular === 'task';
  const isOpportunityMode = objectNameSingular === 'opportunity';
  const isPersonMode = objectNameSingular === 'person';
  const isCompanyMode = objectNameSingular === 'company';

  // Object mode: optional deal/contact pickers, plus logging against one of the
  // contact's open tasks (which switches the surface into that task's context).
  const [pickedOpportunityId, setPickedOpportunityId] = useState<string | null>(
    null,
  );
  const [pickedPersonId, setPickedPersonId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // Effective task = the task record (task mode) or a selected open task (object
  // mode). In task context the surface behaves exactly like the task's own.
  const taskId = isTaskMode ? recordId : (selectedTaskId ?? undefined);
  const inTaskContext = isDefined(taskId);

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

  // Person mode: the record is the contact; the deals to attach to are the
  // opportunities they're the point-of-contact on.
  const { records: personDeals } = useFindManyRecords({
    objectNameSingular: 'opportunity',
    filter: { pointOfContactId: { eq: isPersonMode ? recordId : undefined } },
    recordGqlFields: { id: true, name: true },
    skip: !isPersonMode || !isDefined(recordId),
  });

  // Company mode: pick a contact (its people) and a deal (its opportunities).
  const { records: companyContacts } = useFindManyRecords({
    objectNameSingular: 'person',
    filter: { companyId: { eq: isCompanyMode ? recordId : undefined } },
    recordGqlFields: { id: true, name: { firstName: true, lastName: true } },
    skip: !isCompanyMode || !isDefined(recordId),
  });
  const { records: companyDeals } = useFindManyRecords({
    objectNameSingular: 'opportunity',
    filter: { companyId: { eq: isCompanyMode ? recordId : undefined } },
    recordGqlFields: { id: true, name: true },
    skip: !isCompanyMode || !isDefined(recordId),
  });

  // The contact resolved from the record/pickers (before any task is selected).
  const objectPersonId = isOpportunityMode
    ? ((opportunityRecord as { pointOfContactId?: string } | undefined)
        ?.pointOfContactId ?? undefined)
    : isPersonMode
      ? recordId
      : isCompanyMode
        ? (pickedPersonId ?? undefined)
        : undefined;

  // The selected task's pinned deal — used only as an overridable DEFAULT for the
  // deal picker in object mode (the manager can change or clear it).
  const taskPinnedOpportunityId = taskTargets?.find((target) =>
    isDefined(target.targetOpportunityId),
  )?.targetOpportunityId as string | undefined;

  // On the task RECORD surface the deal + contact come from the task's pins. In
  // object/launcher mode they come from the manager's independent picks (the deal
  // is seeded from a selected task but stays overridable — see the effect below).
  const opportunityId = isTaskMode
    ? taskPinnedOpportunityId
    : isOpportunityMode
      ? (opportunityRecordId ?? undefined)
      : (pickedOpportunityId ?? undefined);
  const personId = isTaskMode
    ? (taskTargets?.find((target) => isDefined(target.targetPersonId))
        ?.targetPersonId as string | undefined)
    : objectPersonId;

  const { record: person } = useFindOneRecord({
    objectNameSingular: 'person',
    objectRecordId: personId,
    skip: !isDefined(personId),
  });

  // Object mode: the contact's open tasks — selecting one logs the touch against
  // it (sets its outcome + feeds the cadence) instead of as a standalone touch.
  // Read the task via the taskTarget→task relation in one query (the taskId
  // scalar isn't reliably returned by the generic hook).
  const { records: personTaskTargets } = useFindManyRecords({
    objectNameSingular: 'taskTarget',
    filter: { targetPersonId: { eq: isTaskMode ? undefined : objectPersonId } },
    recordGqlFields: {
      id: true,
      task: { id: true, title: true, status: true, channel: true },
    },
    skip: isTaskMode || !isDefined(objectPersonId),
  });
  const openTasks = (personTaskTargets ?? [])
    .map(
      (target) =>
        (
          target as {
            task?: {
              id: string;
              title?: string;
              status?: string;
              channel?: string;
            };
          }
        ).task,
    )
    .filter(
      (task): task is { id: string; title?: string; channel?: string } =>
        isDefined(task) && (task as { status?: string }).status !== 'DONE',
    );

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
  const [sendPersonSms, { loading: isSendingPersonSms }] = useMutation<{
    sendPersonSms: { success: boolean; error?: string | null };
  }>(SEND_PERSON_SMS);
  const isSendingSms = isSendingTaskSms || isSendingPersonSms;

  // Corporate-SMS compose modal. Task mode: the alias is the deal's project brand
  // (server-determined, read-only). Object mode: a touch targets the PERSON, so
  // the manager picks among the brands that person has consented to.
  const { openModal, closeModal } = useModal();
  const [smsMessage, setSmsMessage] = useState('');
  const [selectedSmsAlias, setSelectedSmsAlias] = useState<string>('');
  const [
    fetchTaskSmsContext,
    { data: taskSmsContextData, loading: isLoadingTaskSmsContext },
  ] = useLazyQuery<{
    taskSmsContext: {
      alias: string | null;
      canSend: boolean;
      reason: string | null;
    };
  }>(TASK_SMS_CONTEXT, { fetchPolicy: 'network-only' });
  const [
    fetchPersonSmsContext,
    { data: personSmsContextData, loading: isLoadingPersonSmsContext },
  ] = useLazyQuery<{
    personSmsContext: {
      aliases: string[];
      canSend: boolean;
      reason: string | null;
    };
  }>(PERSON_SMS_CONTEXT, { fetchPolicy: 'network-only' });
  const taskSmsContext = taskSmsContextData?.taskSmsContext;
  const personSmsContext = personSmsContextData?.personSmsContext;
  // Task RECORD surface = the deal's project alias (read-only). Everywhere else
  // (object/launcher, even with a task selected) = the person's consented aliases.
  const isLoadingSmsContext = isTaskMode
    ? isLoadingTaskSmsContext
    : isLoadingPersonSmsContext;
  const smsCanSend = isTaskMode
    ? taskSmsContext?.canSend === true
    : personSmsContext?.canSend === true;
  const smsReason = isTaskMode
    ? taskSmsContext?.reason
    : personSmsContext?.reason;
  const personAliases = personSmsContext?.aliases ?? [];
  const effectiveSmsAlias =
    selectedSmsAlias !== '' ? selectedSmsAlias : (personAliases[0] ?? '');

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

  // Object/launcher mode: pre-select the contact's first open task (overridable
  // via the Task picker, including clearing it). Guarded to apply once per
  // contact so a manual clear/change sticks.
  const [autoSelectedTaskForPerson, setAutoSelectedTaskForPerson] = useState<
    string | null
  >(null);
  useEffect(() => {
    if (isTaskMode || !isDefined(objectPersonId)) {
      return;
    }
    if (autoSelectedTaskForPerson === objectPersonId) {
      return;
    }
    if (openTasks.length === 0) {
      return;
    }
    setAutoSelectedTaskForPerson(objectPersonId);
    setSelectedTaskId((current) => current ?? openTasks[0].id);
  }, [isTaskMode, objectPersonId, openTasks, autoSelectedTaskForPerson]);

  // Seed the deal + channel from a newly selected task as overridable DEFAULTS
  // (the manager can change either, or clear the task). Once per task selection,
  // and only after the task's record + targets have loaded.
  const [seededFromTask, setSeededFromTask] = useState<string | null>(null);
  useEffect(() => {
    if (isTaskMode) {
      return;
    }
    if (!isDefined(selectedTaskId)) {
      if (seededFromTask !== null) {
        setSeededFromTask(null);
      }

      return;
    }
    if (seededFromTask === selectedTaskId) {
      return;
    }
    if (task?.id !== selectedTaskId) {
      return;
    }
    setSeededFromTask(selectedTaskId);
    setPickedOpportunityId(taskPinnedOpportunityId ?? null);
    setSelectedChannel((task?.channel as string | null | undefined) ?? null);
  }, [
    isTaskMode,
    selectedTaskId,
    task,
    taskPinnedOpportunityId,
    seededFromTask,
  ]);

  // Task RECORD surface locks the channel to the task. Object/launcher mode lets
  // the manager pick (seeded from a selected task's channel, but overridable).
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
      setSelectedSmsAlias('');
      // Refresh each time the modal opens. Task record = deal's project alias;
      // object/launcher = the brands the contact has consented to.
      if (isTaskMode && isDefined(taskId)) {
        fetchTaskSmsContext({ variables: { taskId } });
      } else {
        fetchPersonSmsContext({ variables: { personId: personId ?? null } });
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
    if (smsMessage.trim() === '' || isSendingSms || !smsCanSend) {
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
      if (effectiveSmsAlias === '') {
        return;
      }
      const result = await sendPersonSms({
        variables: {
          personId: personId ?? null,
          message: smsMessage,
          alias: effectiveSmsAlias,
          opportunityId: opportunityId ?? null,
        },
      });

      outcome = result.data?.sendPersonSms;
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
    // Need a target: the task (task record surface) or the person (object mode).
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

      // Whenever a task is linked (its own surface, or one selected in object
      // mode), stamp its reachability outcome — feeds the sequence/cadence.
      if (isDefined(taskId)) {
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
  // Surface shows on the task record, or once a channel is chosen in object mode
  // (the channel is seeded from a selected task, so picking a task reveals it).
  const surfaceVisible = isTaskMode || isDefined(selectedChannel);

  // A touch targets a PERSON. Company mode needs a contact picked first; the
  // deal is always optional context. Person/opportunity already have the person.
  const needsContact = isCompanyMode;
  const showDealPicker = isPersonMode || isCompanyMode;
  const pickersResolved = !needsContact || isDefined(pickedPersonId);

  const dealPickerOptions = (
    (isPersonMode ? personDeals : companyDeals) ?? []
  ).map((deal) => ({
    label: ((deal as { name?: string }).name ?? '') || 'Untitled deal',
    value: deal.id as string,
  }));
  const contactPickerOptions = (companyContacts ?? []).map((contact) => {
    const name = (
      contact as { name?: { firstName?: string; lastName?: string } }
    ).name;
    const label =
      `${name?.firstName ?? ''} ${name?.lastName ?? ''}`.trim() ||
      'Unnamed contact';

    return { label, value: contact.id as string };
  });

  // Channel and task are independent in object mode: picking a channel just
  // overrides the (task-seeded) channel; it does NOT clear the selected task.
  const handleSelectChannel = (value: string) => {
    setSelectedChannel(value);
    setSelectedOutcome(null);
    setCallStartedAt(null);
    setCallDurationS(null);
    setPendingLoggedVia('MANUAL_LOG');
  };

  // Task picker (object mode). Selecting a task seeds its deal + channel as
  // overridable defaults (see effect); clearing it ("No task") wipes those seeds
  // so the manager starts from a clean standalone touch.
  const handleSelectTask = (id: string | null) => {
    setSelectedTaskId(id);
    setSelectedOutcome(null);
    setCallStartedAt(null);
    setCallDurationS(null);
    setPendingLoggedVia('MANUAL_LOG');
    if (!isDefined(id)) {
      setSelectedChannel(null);
      setPickedOpportunityId(null);
    }
  };

  const resetChannelOnPick = () => {
    setSelectedChannel(null);
    setSelectedOutcome(null);
    setCallStartedAt(null);
    setCallDurationS(null);
  };

  return (
    <StyledContainer>
      {!isTaskMode && (
        <StyledSection>
          {/* Contact, task, and deal are independent optional links. The task is
              pre-selected if the contact has an open one (overridable/clearable);
              the deal is seeded from a selected task but can be changed/cleared. */}
          {needsContact && (
            <Select
              dropdownId="actions-contact-picker"
              label="Contact"
              options={contactPickerOptions}
              emptyOption={{ label: 'Select a contact…', value: '' }}
              value={pickedPersonId ?? ''}
              onChange={(value) => {
                setPickedPersonId(value === '' ? null : value);
                setSelectedTaskId(null);
                resetChannelOnPick();
              }}
              withSearchInput
              fullWidth
            />
          )}

          {openTasks.length > 0 && (
            <Select
              dropdownId="actions-task-picker"
              label="Against task (optional)"
              options={[
                { label: 'No task', value: '' },
                ...openTasks.map((openTask) => ({
                  label: openTask.title ?? 'Untitled task',
                  value: openTask.id,
                })),
              ]}
              value={selectedTaskId ?? ''}
              onChange={(value) =>
                handleSelectTask(value === '' ? null : value)
              }
              withSearchInput
              fullWidth
            />
          )}

          {showDealPicker && (
            <Select
              dropdownId="actions-deal-picker"
              label="Related deal (optional)"
              options={[{ label: 'No deal', value: '' }, ...dealPickerOptions]}
              value={pickedOpportunityId ?? ''}
              onChange={(value) =>
                setPickedOpportunityId(value === '' ? null : value)
              }
              withSearchInput
              fullWidth
            />
          )}

          {pickersResolved && (
            <>
              <StyledSectionLabel>
                {isDefined(personId)
                  ? 'How did you reach them? — pick the channel'
                  : 'No contact / phone on file'}
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
                    accent={
                      selectedChannel === option.value ? 'blue' : 'default'
                    }
                    disabled={!isDefined(personId)}
                    onClick={() => handleSelectChannel(option.value)}
                  />
                ))}
              </StyledRow>
            </>
          )}
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

          {inTaskContext && (
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
            ) : !smsCanSend ? (
              <StyledModalBlocked>
                {smsReason ?? 'This SMS can’t be sent.'}
              </StyledModalBlocked>
            ) : isTaskMode ? (
              <StyledModalNote>
                Sending as {taskSmsContext?.alias}
              </StyledModalNote>
            ) : (
              <Select
                dropdownId="task-sms-alias"
                label="Send as"
                options={personAliases.map((alias) => ({
                  label: alias,
                  value: alias,
                }))}
                value={effectiveSmsAlias}
                onChange={setSelectedSmsAlias}
                fullWidth
              />
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
              !smsCanSend ||
              (!isTaskMode && effectiveSmsAlias === '')
            }
            onClick={handleSendSms}
          />
        </ModalFooter>
      </ModalStatefulWrapper>
    </StyledContainer>
  );
};
