import { splitCommentIntoMentionParts } from '@/page-layout/widgets/deal-comments/utils/splitCommentIntoMentionParts';

describe('splitCommentIntoMentionParts', () => {
  it('should mark each @name as a mention', () => {
    expect(
      splitCommentIntoMentionParts('@Ana Popescu can you call?', [
        'Ana Popescu',
      ]),
    ).toEqual([
      { text: '@Ana Popescu', isMention: true },
      { text: ' can you call?', isMention: false },
    ]);
  });

  it('should prefer the longest matching name', () => {
    expect(
      splitCommentIntoMentionParts('@Ana Popescu hi', ['Ana', 'Ana Popescu']),
    ).toEqual([
      { text: '@Ana Popescu', isMention: true },
      { text: ' hi', isMention: false },
    ]);
  });

  it('should leave a comment with no known names untouched', () => {
    expect(splitCommentIntoMentionParts('email ana@enso.ro', ['Ion'])).toEqual([
      { text: 'email ana@enso.ro', isMention: false },
    ]);
  });
});
