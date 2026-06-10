import { type EventRowDynamicComponentProps } from '@/activities/timeline-activities/rows/components/EventRowDynamicComponent.types';
import { useOpenRecordInSidePanel } from '@/side-panel/hooks/useOpenRecordInSidePanel';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { isNonEmptyString } from '@sniptt/guards';
import { MOBILE_VIEWPORT, themeCssVariables } from 'twenty-ui/theme-constants';

// ENSO — renders `enso-event.<action>` automation events (company linking, B2B
// account-deal flow). The backend composes a plain-English sentence as an array
// of `properties.segments`: plain-text runs and clickable record links. We render
// them inline so it reads as a sentence, then append the actor:
//   properties.auto → "— automatically", else "— by {author}".

type EnsoTimelineSegment =
  | { text: string }
  | { label: string; objectNameSingular: string; recordId: string };

const isLinkSegment = (
  segment: EnsoTimelineSegment,
): segment is {
  label: string;
  objectNameSingular: string;
  recordId: string;
} =>
  isNonEmptyString((segment as { recordId?: string }).recordId) &&
  isNonEmptyString(
    (segment as { objectNameSingular?: string }).objectNameSingular,
  );

const StyledRowContainer = styled.div`
  align-items: baseline;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
`;

const StyledSentence = styled.div`
  color: ${themeCssVariables.font.color.primary};
  line-height: 1.5;
`;

const StyledLink = styled.span`
  color: ${themeCssVariables.font.color.primary};
  cursor: pointer;
  font-weight: 500;
  text-decoration: underline;
`;

const StyledActor = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
`;

const StyledDate = styled.div`
  @media (max-width: ${MOBILE_VIEWPORT}px) {
    display: none;
  }
  color: ${themeCssVariables.font.color.tertiary};
  flex-shrink: 0;
  padding: 0 ${themeCssVariables.spacing[1]};
`;

export const EventRowEnsoEvent = ({
  authorFullName,
  event,
  createdAt,
}: EventRowDynamicComponentProps) => {
  const { openRecordInSidePanel } = useOpenRecordInSidePanel();

  const segments: EnsoTimelineSegment[] = Array.isArray(
    event.properties?.segments,
  )
    ? event.properties.segments
    : [];

  const auto = event.properties?.auto === true;

  return (
    <StyledRowContainer>
      <StyledSentence>
        {segments.map((segment, index) =>
          isLinkSegment(segment) ? (
            <StyledLink
              key={index}
              onClick={() =>
                openRecordInSidePanel({
                  recordId: segment.recordId,
                  objectNameSingular: segment.objectNameSingular,
                })
              }
            >
              {segment.label}
            </StyledLink>
          ) : (
            <span key={index}>{(segment as { text: string }).text}</span>
          ),
        )}
        <StyledActor>
          {auto ? t` — automatically` : t` — by ${authorFullName}`}
        </StyledActor>
      </StyledSentence>
      <StyledDate>{createdAt}</StyledDate>
    </StyledRowContainer>
  );
};
