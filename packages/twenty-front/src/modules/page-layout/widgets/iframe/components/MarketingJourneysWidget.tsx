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
// its point of contact). Shows which Dittofeed journeys the contact is in / has
// been in and at what step (from the marketingEnrollment object the journey
// callbacks populate), plus the messages actually sent to them (proxied from
// Dittofeed's deliveries API server-side). Read-only.
export const ENSO_MARKETING_JOURNEYS_MARKER = '__enso_marketing_journeys';

type Delivery = {
  channel: string;
  status: string;
  sentAt: string | null;
  templateId: string | null;
  journeyId: string | null;
};

// Dittofeed email delivery statuses → friendly labels (+ a state for colour).
const STATUS_META: Record<string, { label: string; state: string }> = {
  DFEmailDelivered: { label: 'Delivered', state: 'ok' },
  DFEmailOpened: { label: 'Opened', state: 'good' },
  DFEmailClicked: { label: 'Clicked', state: 'good' },
  DFEmailSent: { label: 'Sent', state: 'ok' },
  DFEmailBounced: { label: 'Bounced', state: 'bad' },
  DFEmailDropped: { label: 'Dropped', state: 'bad' },
  DFEmailMarkedSpam: { label: 'Marked spam', state: 'bad' },
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

const prettyStep = (step: unknown): string =>
  typeof step === 'string' ? step.replace(/_/g, ' ') : '';

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

const StyledHint = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
`;

const StyledSectionTitle = styled.div`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.xs};
  font-weight: ${themeCssVariables.font.weight.medium};
  text-transform: uppercase;
`;

const StyledRow = styled.div`
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
  padding: ${themeCssVariables.spacing[2]};
`;

const StyledRowHeader = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
`;

const StyledJourneyName = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-weight: ${themeCssVariables.font.weight.medium};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

// $state: active (blue) | finished (green) | exited (muted)
const StyledBadge = styled.span<{ $state: string }>`
  border-radius: ${themeCssVariables.border.radius.sm};
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

const StyledMeta = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
`;

const StyledMessageLine = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
`;

const StyledMessageLabel = styled.span`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
`;

// $state: good (green) | ok (secondary) | bad (danger)
const StyledMessageStatus = styled.span<{ $state: string }>`
  color: ${({ $state }) =>
    $state === 'good'
      ? themeCssVariables.color.green
      : $state === 'bad'
        ? themeCssVariables.font.color.danger
        : themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
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

  // On an Opportunity, resolve its point of contact → the person whose
  // enrollments/messages we show.
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
      .catch(() => {
        // Best-effort — the enrollment list still renders without deliveries.
      });

    return () => {
      cancelled = true;
    };
  }, [personId]);

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

  return (
    <StyledContainer>
      <StyledSectionTitle>{t`Marketing journeys`}</StyledSectionTitle>

      {loading ? (
        <StyledHint>{t`Loading…`}</StyledHint>
      ) : enrollments.length === 0 ? (
        <StyledHint>{t`Not in any marketing journey yet.`}</StyledHint>
      ) : (
        enrollments.map((enrollment) => (
          <StyledRow key={enrollment.id as string}>
            <StyledRowHeader>
              <StyledJourneyName>
                {(enrollment.journey as string) ?? t`Journey`}
              </StyledJourneyName>
              <StyledBadge $state={statusBadgeState(enrollment.status)}>
                {enrollment.status as string}
              </StyledBadge>
            </StyledRowHeader>
            <StyledMeta>
              {t`Step:`} {prettyStep(enrollment.currentStep) || '—'}
              {isDefined(enrollment.enteredAt) &&
              formatDate(enrollment.enteredAt) !== ''
                ? ` · ${t`entered`} ${formatDate(enrollment.enteredAt)}`
                : ''}
            </StyledMeta>
          </StyledRow>
        ))
      )}

      {deliveries.length > 0 && (
        <>
          <StyledSectionTitle>{t`Messages sent`}</StyledSectionTitle>
          <StyledRow>
            {deliveries.map((delivery, index) => {
              const meta = STATUS_META[delivery.status] ?? {
                label: delivery.status,
                state: 'ok',
              };
              const date = formatDate(delivery.sentAt);

              return (
                <StyledMessageLine key={index}>
                  <StyledMessageLabel>
                    {delivery.channel}
                    {date !== '' ? ` · ${date}` : ''}
                  </StyledMessageLabel>
                  <StyledMessageStatus $state={meta.state}>
                    {meta.label}
                  </StyledMessageStatus>
                </StyledMessageLine>
              );
            })}
          </StyledRow>
        </>
      )}
    </StyledContainer>
  );
};
