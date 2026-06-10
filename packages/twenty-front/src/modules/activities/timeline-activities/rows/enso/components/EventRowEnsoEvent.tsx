import { type EventRowDynamicComponentProps } from '@/activities/timeline-activities/rows/components/EventRowDynamicComponent.types';
import { EventRowItem } from '@/activities/timeline-activities/rows/components/EventRowItem';
import { useOpenRecordInSidePanel } from '@/side-panel/hooks/useOpenRecordInSidePanel';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { isNonEmptyString } from '@sniptt/guards';
import { MOBILE_VIEWPORT, themeCssVariables } from 'twenty-ui/theme-constants';

// ENSO — generic renderer for `enso-event.<action>` automation events (company
// linking, B2B account-deal flow, etc.). Driven entirely by the event payload:
// a verb from the action, the clickable linked record (linkedRecordCachedName),
// the "why" (properties.reason), and the actor (properties.auto → "automatically",
// else "by {author}"). Mirrors EventRowEnsoConsent. Keep the prefix in sync with
// ENSO_EVENT_ACTIVITY_NAME_PREFIX on the server.

// action → leading verb. Phrased to read naturally with the linked record name.
const ACTION_VERB: Record<string, string> = {
  'company-linked': t`Linked to`,
  'activity-logged': t`Logged`,
  'deal-activity-attached': t`Activity added to deal`,
  'deal-created': t`Opened deal`,
  'deal-contact-added': t`Added contact`,
  'account-assigned': t`Set account owner`,
};

const StyledRowContainer = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
  justify-content: space-between;
`;

const StyledRow = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[1]};
  overflow: hidden;
`;

const StyledLinked = styled.span`
  color: ${themeCssVariables.font.color.primary};
  cursor: pointer;
  overflow: hidden;
  text-decoration: underline;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledPlain = styled.span`
  color: ${themeCssVariables.font.color.primary};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledItemTitleDate = styled.div`
  @media (max-width: ${MOBILE_VIEWPORT}px) {
    display: none;
  }
  color: ${themeCssVariables.font.color.tertiary};
  padding: 0 ${themeCssVariables.spacing[1]};
`;

export const EventRowEnsoEvent = ({
  authorFullName,
  event,
  linkedObjectMetadataItem,
  createdAt,
}: EventRowDynamicComponentProps) => {
  const action = event.name.split('.')[1] ?? '';
  const verb = ACTION_VERB[action] ?? action.replace(/-/g, ' ');

  const cachedName = isNonEmptyString(event.linkedRecordCachedName)
    ? event.linkedRecordCachedName
    : t`a record`;

  const reason = event.properties?.reason as string | undefined;
  const auto = event.properties?.auto === true;

  const { openRecordInSidePanel } = useOpenRecordInSidePanel();
  const linkedRecordId = event.linkedRecordId;
  const objectNameSingular = linkedObjectMetadataItem?.nameSingular;
  const clickable =
    isNonEmptyString(linkedRecordId) && isNonEmptyString(objectNameSingular);

  return (
    <StyledRowContainer>
      <StyledRow>
        <EventRowItem variant="action">{verb}</EventRowItem>
        {clickable ? (
          <StyledLinked
            onClick={() =>
              openRecordInSidePanel({
                recordId: linkedRecordId,
                objectNameSingular,
              })
            }
          >
            {cachedName}
          </StyledLinked>
        ) : (
          <StyledPlain>{cachedName}</StyledPlain>
        )}
        {isNonEmptyString(reason) && (
          <EventRowItem>{`· ${reason}`}</EventRowItem>
        )}
        <EventRowItem variant="action">
          {auto ? t`— automatically` : t`— by`}
        </EventRowItem>
        {!auto && <EventRowItem>{authorFullName}</EventRowItem>}
      </StyledRow>
      <StyledItemTitleDate>{createdAt}</StyledItemTitleDate>
    </StyledRowContainer>
  );
};
