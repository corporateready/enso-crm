import { type EventRowDynamicComponentProps } from '@/activities/timeline-activities/rows/components/EventRowDynamicComponent.types';
import { EventRowItem } from '@/activities/timeline-activities/rows/components/EventRowItem';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { isNonEmptyString } from 'twenty-shared/utils';
import { MOBILE_VIEWPORT, themeCssVariables } from 'twenty-ui/theme-constants';

// ENSO — renders timeline events for a LINKED record (an inbound activity or an
// opportunity surfaced on the person's timeline). The default EventRowMainObject
// would mislabel these with the MAIN record's name ("Elena was created"), so we
// render the linked record's cached name instead.
const StyledMainContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
  width: 100%;
`;

const StyledRowContainer = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
  justify-content: space-between;
`;

const StyledItemTitleDate = styled.div`
  @media (max-width: ${MOBILE_VIEWPORT}px) {
    display: none;
  }
  color: ${themeCssVariables.font.color.tertiary};
  padding: 0 ${themeCssVariables.spacing[1]};
`;

const StyledRow = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
  overflow: hidden;
`;

export const EventRowEnsoLinkedRecord = ({
  authorFullName,
  event,
  createdAt,
}: EventRowDynamicComponentProps) => {
  const [, eventAction] = event.name.split('.');

  const cachedName = isNonEmptyString(event.linkedRecordCachedName)
    ? event.linkedRecordCachedName
    : t`a record`;

  const actionLabel =
    eventAction === 'created'
      ? t`was added by`
      : eventAction === 'updated'
        ? t`was updated by`
        : `${eventAction} ${t`by`}`;

  return (
    <StyledMainContainer>
      <StyledRowContainer>
        <StyledRow>
          <EventRowItem>{cachedName}</EventRowItem>
          <EventRowItem variant="action">{actionLabel}</EventRowItem>
          <EventRowItem>{authorFullName}</EventRowItem>
        </StyledRow>
        <StyledItemTitleDate>{createdAt}</StyledItemTitleDate>
      </StyledRowContainer>
    </StyledMainContainer>
  );
};
