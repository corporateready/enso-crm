import { type EnsoTimelineSegment } from 'src/modules/enso/timeline/enso-timeline.util';

// The timeline shows who was asked and the start of what was said; the full
// thread is on the deal's Comments tab.
const TIMELINE_PREVIEW_LENGTH = 140;

// Colleagues are named in plain text, not as links: a link opens the record in
// the side panel, and workspace members are not records a manager can open.
export const buildDealCommentTimelineSegments = ({
  body,
  mentionedMemberNames,
}: {
  body: string;
  mentionedMemberNames: string[];
}): EnsoTimelineSegment[] => {
  const preview =
    body.length > TIMELINE_PREVIEW_LENGTH
      ? `${body.slice(0, TIMELINE_PREVIEW_LENGTH)}…`
      : body;

  return [
    {
      text: `Commented, mentioning ${mentionedMemberNames.join(', ')}: “${preview}”`,
    },
  ];
};
