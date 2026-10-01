import { buildDealCommentTimelineSegments } from 'src/modules/enso/deal-comment/utils/build-deal-comment-timeline-segments.util';

describe('buildDealCommentTimelineSegments', () => {
  it('should name every mentioned colleague and quote the comment', () => {
    expect(
      buildDealCommentTimelineSegments({
        body: 'Is unit 12 still free?',
        mentionedMemberNames: ['Ana Popescu', 'Ion Rusu'],
      }),
    ).toEqual([
      {
        text: 'Commented, mentioning Ana Popescu, Ion Rusu: “Is unit 12 still free?”',
      },
    ]);
  });

  it('should cut a long comment down to a preview', () => {
    expect(
      buildDealCommentTimelineSegments({
        body: 'a'.repeat(300),
        mentionedMemberNames: ['Ana Popescu'],
      }),
    ).toEqual([
      { text: `Commented, mentioning Ana Popescu: “${'a'.repeat(140)}…”` },
    ]);
  });
});
