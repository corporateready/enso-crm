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
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { currentWorkspaceMemberState } from '@/auth/states/currentWorkspaceMemberState';
import { useCreateOneRecord } from '@/object-record/hooks/useCreateOneRecord';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useFindOneRecord } from '@/object-record/hooks/useFindOneRecord';
import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { type PageLayoutWidget } from '@/page-layout/types/PageLayoutWidget';
import { useLayoutRenderingContext } from '@/ui/layout/contexts/LayoutRenderingContext';
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
  buildHref?: (context: LinkContext) => string | undefined;
};

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
        onSystemLabel: 'On system · gateway, delivery captured (one-way)',
        onSystem: [{ label: 'Send corporate SMS', Icon: IconSend, soon: true }],
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
  const taskId = targetRecordIdentifier?.id;

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

  // Resolve the deal + person from the task's taskTarget pins (reliable) — the
  // nested task.sequenceRun.opportunityId is not returned by the record fetch,
  // which is why earlier manual logs landed orphaned from their deal.
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

  const opportunityId = taskTargets?.find((target) =>
    isDefined(target.targetOpportunityId),
  )?.targetOpportunityId as string | undefined;
  const personId = taskTargets?.find((target) =>
    isDefined(target.targetPersonId),
  )?.targetPersonId as string | undefined;

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

  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [pendingLoggedVia, setPendingLoggedVia] =
    useState<string>('MANUAL_LOG');
  // Manual call timer: a plain off-system call reports no duration, so we time it
  // CRM-side from "Call manually" until the manager hits Stop.
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [callDurationS, setCallDurationS] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const isTiming = isDefined(callStartedAt) && !isDefined(callDurationS);

  useEffect(() => {
    if (!isTiming) {
      return;
    }
    const intervalId = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(intervalId);
  }, [isTiming]);

  const channel = (task?.channel as string | null | undefined) ?? null;
  const surface = getChannelSurface(channel);
  const linkContext = buildLinkContext(person as PersonForLinks | undefined);

  // The corporate-GSM call is on-system (the recording SIM captures both ways) but
  // dials via a plain tel: — gated to capable managers, marked CORPORATE_GSM so a
  // synced recording can attach later.
  const onSystemActions: ActionConfig[] =
    channel === 'CALL' && hasRecordingGsm
      ? [
          {
            label: 'Call from corporate GSM',
            Icon: IconDeviceMobile,
            startsTimer: true,
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

  const handleOpen = (href: string | undefined) => {
    if (!isDefined(href)) {
      return;
    }
    // Open in a separate context so the deep-link hand-off never freezes this
    // page: on mobile the dialer/app opens; on desktop a blank tab is the only
    // (harmless) cost. (Navigating the current tab to tel: hangs desktop.)
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  const handleStartCall = (href: string | undefined, loggedVia: string) => {
    setPendingLoggedVia(loggedVia);
    setCallDurationS(null);
    setCallStartedAt(Date.now());
    setNow(Date.now());
    handleOpen(href);
  };

  const handleStopCall = () => {
    if (isDefined(callStartedAt)) {
      setCallDurationS(
        Math.max(1, Math.floor((Date.now() - callStartedAt) / 1000)),
      );
    }
  };

  const handleLog = async (outcome: string) => {
    if (!isDefined(taskId) || isSaving) {
      return;
    }

    setIsSaving(true);

    try {
      await createOutboundActivity({
        ...(isDefined(channel) ? { channel } : {}),
        loggedVia: pendingLoggedVia,
        body: notes,
        occurredAt: new Date().toISOString(),
        taskId,
        ...(isDefined(callDurationS) ? { durationS: callDurationS } : {}),
        ...(isDefined(opportunityId) ? { opportunityId } : {}),
        ...(isDefined(personId) ? { personId } : {}),
        ...(isDefined(currentWorkspaceMember?.id)
          ? { performedById: currentWorkspaceMember.id }
          : {}),
      });

      await updateOneRecord({
        objectNameSingular: 'task',
        idToUpdate: taskId,
        updateOneRecordInput: { outcome, status: 'DONE' },
      });

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
    const isDisabled = action.soon === true || (isDeepLink && !isDefined(href));

    const onClick =
      action.startsTimer === true
        ? () => handleStartCall(href, action.loggedVia ?? 'MANUAL_LOG')
        : isDeepLink
          ? () => handleOpen(href)
          : undefined;

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

  return (
    <StyledContainer>
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
            <StyledSectionLabel>{surface.offSystemLabel}</StyledSectionLabel>
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
        <StyledSectionLabel>Log what happened on this touch</StyledSectionLabel>
        <StyledTextArea
          placeholder="Notes (what you said, what they wanted)…"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
        <StyledRow>
          {surface.outcomes.map((outcome) => (
            <Button
              key={outcome}
              title={OUTCOME_LABELS[outcome] ?? outcome}
              variant="secondary"
              disabled={isSaving}
              onClick={() => handleLog(outcome)}
            />
          ))}
        </StyledRow>
      </StyledSection>

      {surface.dealDispositionNote === true && (
        <StyledFootnote>
          Deal outcome (not interested / bought elsewhere) is set on the deal,
          separately — it isn't a task action.
        </StyledFootnote>
      )}
    </StyledContainer>
  );
};
