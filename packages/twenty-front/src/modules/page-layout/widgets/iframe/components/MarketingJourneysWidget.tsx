import { useLingui } from '@lingui/react/macro';
import { styled } from '@linaria/react';
import { useEffect, useState } from 'react';
import { isDefined } from 'twenty-shared/utils';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { REST_API_BASE_URL } from '@/apollo/constant/rest-api-base-url';
import { getTokenPair } from '@/apollo/utils/getTokenPair';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useLayoutRenderingContext } from '@/ui/layout/contexts/LayoutRenderingContext';

// ENSO — manager-facing marketing-journey view on a Person (or Opportunity, via
// its point of contact). One collapsible card per journey: the full authored
// step sequence (done / current / upcoming), with live delivery status overlaid
// on the emails that already went out. Read-only.
export const ENSO_MARKETING_JOURNEYS_MARKER = '__enso_marketing_journeys';

type Delivery = {
  channel: string;
  status: string;
  sentAt: string | null;
  templateId: string | null;
  journeyId: string | null;
};

// Dittofeed email statuses → friendly label + colour state.
const STATUS_META: Record<string, { label: string; state: string }> = {
  DFEmailDelivered: { label: 'Delivered', state: 'ok' },
  DFEmailOpened: { label: 'Opened', state: 'good' },
  DFEmailClicked: { label: 'Clicked', state: 'good' },
  DFEmailSent: { label: 'Sent', state: 'ok' },
  DFEmailBounced: { label: 'Bounced', state: 'bad' },
  DFEmailDropped: { label: 'Dropped', state: 'bad' },
  DFEmailMarkedSpam: { label: 'Marked spam', state: 'bad' },
};

// We author the journeys, so we know each step sequence + the email subjects —
// which lets us show steps that haven't happened yet ("upcoming") and name the
// emails. `email: true` steps are matched, in order, to the user's deliveries.
// `dittofeedJourneyId` attributes deliveries to the right journey when a person
// is in several. Unknown journeys fall back to just the current step.
type JourneyStep = { key: string; label: string; email?: boolean };
const JOURNEY_DEFINITIONS: Record<
  string,
  { label: string; dittofeedJourneyId?: string; steps: JourneyStep[] }
> = {
  ENSO_ESTATE_INTRO: {
    label: 'ENSO Estate · Intro',
    dittofeedJourneyId: 'c1e85ea4-5f4d-4b5b-aecd-ccd247cae95e',
    steps: [
      { key: 'entered', label: 'Entered journey' },
      { key: 'email_1_sent', label: 'Welcome to ENSO', email: true },
      {
        key: 'email_2_sent',
        label: 'What makes an ENSO home different',
        email: true,
      },
      { key: 'email_3_sent', label: 'Want to see it in person?', email: true },
      { key: 'finished', label: 'Completed' },
    ],
  },
};

const ENROLLMENT_GQL_FIELDS = {
  id: true,
  journey: true,
  status: true,
  currentStep: true,
  enteredAt: true,
  lastEventAt: true,
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
  gap: ${themeCssVariables.spacing[2]};
  max-width: 100%;
  overflow-x: hidden;
  padding: ${themeCssVariables.spacing[2]};
  width: 100%;

  & * {
    box-sizing: border-box;
  }
`;

const StyledHint = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
  padding: ${themeCssVariables.spacing[2]};
`;

const StyledCard = styled.div`
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.md};
  overflow: hidden;
`;

const StyledCardHeader = styled.button`
  align-items: center;
  background: ${themeCssVariables.background.secondary};
  border: none;
  cursor: pointer;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]};
  width: 100%;
`;

const StyledHeaderLeft = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  min-width: 0;
`;

const StyledChevron = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
`;

const StyledJourneyName = styled.span`
  color: ${themeCssVariables.font.color.primary};
  font-weight: ${themeCssVariables.font.weight.medium};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

// $state: active (blue) | finished (green) | exited (muted)
const StyledBadge = styled.span<{ $state: string }>`
  color: ${({ $state }) =>
    $state === 'finished'
      ? themeCssVariables.color.green
      : $state === 'exited'
        ? themeCssVariables.font.color.tertiary
        : themeCssVariables.color.blue};
  flex: 0 0 auto;
  font-size: ${themeCssVariables.font.size.xs};
  font-weight: ${themeCssVariables.font.weight.medium};
`;

const StyledSteps = styled.div`
  display: flex;
  flex-direction: column;
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]};
`;

const StyledStepRow = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
  padding: ${themeCssVariables.spacing[1]} 0;
`;

const StyledStepLeft = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  min-width: 0;
`;

// $state: done (green dot) | current (blue dot) | upcoming (hollow/muted)
const StyledDot = styled.span<{ $state: string }>`
  background: ${({ $state }) =>
    $state === 'done'
      ? themeCssVariables.color.green
      : $state === 'current'
        ? themeCssVariables.color.blue
        : 'transparent'};
  border: 1px solid
    ${({ $state }) =>
      $state === 'done'
        ? themeCssVariables.color.green
        : $state === 'current'
          ? themeCssVariables.color.blue
          : themeCssVariables.border.color.strong};
  border-radius: 50%;
  flex: 0 0 auto;
  height: 8px;
  width: 8px;
`;

const StyledStepLabel = styled.span<{ $upcoming: boolean }>`
  color: ${({ $upcoming }) =>
    $upcoming
      ? themeCssVariables.font.color.tertiary
      : themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.sm};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

// $state: good (green) | ok (secondary) | bad (danger) | upcoming (tertiary)
const StyledStepMeta = styled.span<{ $state: string }>`
  color: ${({ $state }) =>
    $state === 'good'
      ? themeCssVariables.color.green
      : $state === 'bad'
        ? themeCssVariables.font.color.danger
        : $state === 'upcoming'
          ? themeCssVariables.font.color.tertiary
          : themeCssVariables.font.color.secondary};
  flex: 0 0 auto;
  font-size: ${themeCssVariables.font.size.xs};
`;

const statusBadgeState = (status: unknown): string =>
  status === 'FINISHED' ? 'finished' : status === 'EXITED' ? 'exited' : 'active';

export const MarketingJourneysWidget = () => {
  const { t } = useLingui();
  const { targetRecordIdentifier } = useLayoutRenderingContext();

  const recordId = targetRecordIdentifier?.id;
  const objectName = targetRecordIdentifier?.targetObjectNameSingular;
  const isPerson = objectName === 'person';
  const isOpportunity = objectName === 'opportunity';

  const { records: opportunities = [] } = useFindManyRecords({
    objectNameSingular: 'opportunity',
    filter: { id: { eq: recordId } },
    recordGqlFields: { id: true, pointOfContactId: true },
    skip: !isOpportunity || !isDefined(recordId),
    limit: 1,
  });

  const personId = isPerson
    ? recordId
    : (opportunities[0]?.pointOfContactId as string | undefined);

  const { records: enrollments = [], loading } = useFindManyRecords({
    objectNameSingular: 'marketingEnrollment',
    filter: { personId: { eq: personId } },
    recordGqlFields: ENROLLMENT_GQL_FIELDS,
    skip: !isDefined(personId),
    limit: 20,
  });

  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isDefined(personId)) {
      return;
    }

    let cancelled = false;
    const token = getTokenPair()?.accessOrWorkspaceAgnosticToken?.token;
    const headers: Record<string, string> = isDefined(token)
      ? { Authorization: `Bearer ${token}` }
      : {};

    fetch(`${REST_API_BASE_URL}/enso/marketing/deliveries?personId=${personId}`, {
      headers,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { deliveries?: Delivery[] } | null) => {
        if (!cancelled && isDefined(data)) {
          setDeliveries(data.deliveries ?? []);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [personId]);

  // Collapse finished/exited journeys by default; keep active ones open.
  useEffect(() => {
    setCollapsed(
      new Set(
        enrollments
          .filter((e) => e.status === 'FINISHED' || e.status === 'EXITED')
          .map((e) => e.id as string),
      ),
    );
  }, [enrollments]);

  if (!isPerson && !isOpportunity) {
    return null;
  }

  if (!isDefined(personId)) {
    return (
      <StyledContainer>
        <StyledHint>{t`No contact linked to show marketing activity for.`}</StyledHint>
      </StyledContainer>
    );
  }

  const toggle = (id: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  if (loading) {
    return (
      <StyledContainer>
        <StyledHint>{t`Loading…`}</StyledHint>
      </StyledContainer>
    );
  }

  if (enrollments.length === 0) {
    return (
      <StyledContainer>
        <StyledHint>{t`Not in any marketing journey yet.`}</StyledHint>
      </StyledContainer>
    );
  }

  return (
    <StyledContainer>
      {enrollments.map((enrollment) => {
        const id = enrollment.id as string;
        const journeyKey = enrollment.journey as string;
        const definition = JOURNEY_DEFINITIONS[journeyKey];
        const status = enrollment.status as string;
        const isOpen = !collapsed.has(id);

        // Deliveries for THIS journey, oldest first — matched in order to the
        // journey's email steps.
        const journeyDeliveries = deliveries
          .filter(
            (delivery) =>
              !isDefined(definition?.dittofeedJourneyId) ||
              delivery.journeyId === definition?.dittofeedJourneyId,
          )
          .slice()
          .sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''));

        const steps = definition?.steps ?? [
          { key: enrollment.currentStep as string, label: t`Current step` },
        ];
        const currentIndex = steps.findIndex(
          (step) => step.key === enrollment.currentStep,
        );
        const isFinished = status === 'FINISHED';

        let emailCursor = 0;

        return (
          <StyledCard key={id}>
            <StyledCardHeader onClick={() => toggle(id)}>
              <StyledHeaderLeft>
                <StyledChevron>{isOpen ? '▾' : '▸'}</StyledChevron>
                <StyledJourneyName>
                  {definition?.label ?? journeyKey}
                </StyledJourneyName>
              </StyledHeaderLeft>
              <StyledBadge $state={statusBadgeState(status)}>
                {status}
              </StyledBadge>
            </StyledCardHeader>

            {isOpen && (
              <StyledSteps>
                {steps.map((step, index) => {
                  const stepState = isFinished
                    ? 'done'
                    : index < currentIndex
                      ? 'done'
                      : index === currentIndex
                        ? 'current'
                        : 'upcoming';
                  const isUpcoming = stepState === 'upcoming';

                  // Attach a delivery to each email step, in order.
                  const delivery = step.email
                    ? journeyDeliveries[emailCursor++]
                    : undefined;

                  let meta = { text: '', state: 'ok' };
                  if (isUpcoming) {
                    meta = { text: t`Upcoming`, state: 'upcoming' };
                  } else if (isDefined(delivery)) {
                    const sm = STATUS_META[delivery.status] ?? {
                      label: delivery.status,
                      state: 'ok',
                    };
                    const date = formatDate(delivery.sentAt);
                    meta = {
                      text: date !== '' ? `${sm.label} · ${date}` : sm.label,
                      state: sm.state,
                    };
                  } else if (stepState === 'current') {
                    meta = { text: t`In progress`, state: 'ok' };
                  } else {
                    meta = { text: t`Done`, state: 'ok' };
                  }

                  return (
                    <StyledStepRow key={step.key}>
                      <StyledStepLeft>
                        <StyledDot $state={stepState} />
                        <StyledStepLabel $upcoming={isUpcoming}>
                          {step.label}
                        </StyledStepLabel>
                      </StyledStepLeft>
                      <StyledStepMeta $state={meta.state}>
                        {meta.text}
                      </StyledStepMeta>
                    </StyledStepRow>
                  );
                })}
              </StyledSteps>
            )}
          </StyledCard>
        );
      })}
    </StyledContainer>
  );
};
