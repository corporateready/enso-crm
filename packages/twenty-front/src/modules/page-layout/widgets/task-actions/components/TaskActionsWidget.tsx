import { styled } from '@linaria/react';
import { useState } from 'react';

import { isDefined } from 'twenty-shared/utils';
import {
  IconBrandWhatsapp,
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
  gap: ${themeCssVariables.spacing[3]};
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
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledStatus = styled.div`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledTextArea = styled.textarea`
  background: ${themeCssVariables.background.transparent.lighter};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.md};
  min-height: 52px;
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
// See docs/logging-architecture.md.

type LinkContext = {
  phoneE164?: string;
  phoneDigits?: string;
  socialUrl?: string;
};

type ActionConfig = {
  label: string;
  Icon: IconComponent;
  variant: 'primary' | 'secondary';
  soon?: boolean;
  buildHref?: (context: LinkContext) => string | undefined;
};

type ChannelSurface = {
  actions: ActionConfig[];
  outcomes: string[];
  observed?: boolean;
  showNotes: boolean;
  dealDispositionNote?: boolean;
};

type PersonForLinks = {
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

const getChannelSurface = (
  channel: string | null | undefined,
): ChannelSurface => {
  switch (channel) {
    case 'CALL':
      return {
        actions: [
          { label: 'Call from web', Icon: IconWorld, variant: 'primary', soon: true },
          { label: 'Request callback', Icon: IconPhone, variant: 'primary', soon: true },
          {
            label: 'Call manually',
            Icon: IconDeviceMobile,
            variant: 'secondary',
            buildHref: (context) =>
              isDefined(context.phoneE164) ? `tel:${context.phoneE164}` : undefined,
          },
        ],
        outcomes: CALL_OUTCOMES,
        showNotes: true,
        dealDispositionNote: true,
      };
    case 'WHATSAPP':
      return {
        actions: [
          {
            label: 'Open corporate chat',
            Icon: IconBrandWhatsapp,
            variant: 'primary',
            soon: true,
          },
          {
            label: 'Open on phone',
            Icon: IconDeviceMobile,
            variant: 'secondary',
            buildHref: (context) =>
              isDefined(context.phoneDigits)
                ? `https://wa.me/${context.phoneDigits}`
                : undefined,
          },
        ],
        outcomes: MESSAGE_OUTCOMES,
        observed: true,
        showNotes: true,
      };
    case 'SMS':
      return {
        actions: [
          { label: 'Send corporate SMS', Icon: IconSend, variant: 'primary', soon: true },
          {
            label: 'Send manually',
            Icon: IconDeviceMobile,
            variant: 'secondary',
            buildHref: (context) =>
              isDefined(context.phoneE164) ? `sms:${context.phoneE164}` : undefined,
          },
        ],
        outcomes: MESSAGE_OUTCOMES,
        showNotes: true,
      };
    case 'SOCIAL':
      return {
        actions: [
          {
            label: 'Open conversation',
            Icon: IconExternalLink,
            variant: 'primary',
            buildHref: (context) => context.socialUrl,
          },
        ],
        outcomes: MESSAGE_OUTCOMES,
        observed: true,
        showNotes: true,
      };
    default:
      return {
        actions: [],
        outcomes: MESSAGE_OUTCOMES,
        showNotes: true,
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
    person?.instagramLink?.primaryLinkUrl ?? person?.facebookLink?.primaryLinkUrl;

  return {
    phoneE164: e164,
    phoneDigits: digits,
    socialUrl: isDefined(socialUrl) && socialUrl !== '' ? socialUrl : undefined,
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
    recordGqlFields: { id: true, targetOpportunityId: true, targetPersonId: true },
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

  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const channel = (task?.channel as string | null | undefined) ?? null;
  const surface = getChannelSurface(channel);
  const linkContext = buildLinkContext(person as PersonForLinks | undefined);

  const handleOpen = (href: string | undefined) => {
    if (isDefined(href)) {
      window.open(href, '_blank', 'noopener,noreferrer');
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
        loggedVia: 'MANUAL_LOG',
        body: notes,
        occurredAt: new Date().toISOString(),
        taskId,
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
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <StyledContainer>
      {surface.actions.length > 0 && (
        <StyledSection>
          <StyledRow>
            {surface.actions.map((action) => {
              const href = action.buildHref?.(linkContext);
              const isDeepLink = isDefined(action.buildHref);
              const isDisabled =
                action.soon === true || (isDeepLink && !isDefined(href));

              return (
                <Button
                  key={action.label}
                  title={action.label}
                  Icon={action.Icon}
                  variant={action.variant}
                  soon={action.soon}
                  disabled={isDisabled}
                  onClick={isDeepLink ? () => handleOpen(href) : undefined}
                />
              );
            })}
          </StyledRow>
          {surface.observed === true && (
            <StyledStatus>
              Waiting for reply — a reply advances the deal to Connected
              automatically.
            </StyledStatus>
          )}
        </StyledSection>
      )}

      {surface.showNotes && (
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
      )}

      {surface.dealDispositionNote === true && (
        <StyledFootnote>
          Deal outcome (not interested / bought elsewhere) is set on the deal,
          separately — it isn't a task action.
        </StyledFootnote>
      )}
    </StyledContainer>
  );
};
