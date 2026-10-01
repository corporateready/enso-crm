import { validateDealCommentInput } from 'src/modules/enso/deal-comment/utils/validate-deal-comment-input.util';

const AUTHOR_ID = 'author-member-id';
const COLLEAGUE_ID = 'colleague-member-id';

describe('validateDealCommentInput', () => {
  it('should accept a comment that mentions a colleague', () => {
    expect(
      validateDealCommentInput({
        body: '  @Ana can you check unit 12?  ',
        mentionedWorkspaceMemberIds: [COLLEAGUE_ID],
        authorWorkspaceMemberId: AUTHOR_ID,
      }),
    ).toEqual({
      isValid: true,
      body: '@Ana can you check unit 12?',
      mentionedWorkspaceMemberIds: [COLLEAGUE_ID],
    });
  });

  it('should reject a comment when no one is mentioned', () => {
    expect(
      validateDealCommentInput({
        body: 'Client wants a discount',
        mentionedWorkspaceMemberIds: [],
        authorWorkspaceMemberId: AUTHOR_ID,
      }),
    ).toEqual({
      isValid: false,
      error: 'Mention at least one colleague with @ to post a comment.',
    });
  });

  it('should reject a comment when the author only mentions themselves', () => {
    expect(
      validateDealCommentInput({
        body: 'Note to self',
        mentionedWorkspaceMemberIds: [AUTHOR_ID],
        authorWorkspaceMemberId: AUTHOR_ID,
      }).isValid,
    ).toBe(false);
  });

  it('should reject an empty comment even when someone is mentioned', () => {
    expect(
      validateDealCommentInput({
        body: '   ',
        mentionedWorkspaceMemberIds: [COLLEAGUE_ID],
        authorWorkspaceMemberId: AUTHOR_ID,
      }),
    ).toEqual({ isValid: false, error: 'The comment is empty.' });
  });

  it('should reject a comment over the length limit', () => {
    expect(
      validateDealCommentInput({
        body: 'a'.repeat(5001),
        mentionedWorkspaceMemberIds: [COLLEAGUE_ID],
        authorWorkspaceMemberId: AUTHOR_ID,
      }).isValid,
    ).toBe(false);
  });

  it('should drop duplicate and blank mentions', () => {
    const result = validateDealCommentInput({
      body: 'ping',
      mentionedWorkspaceMemberIds: [COLLEAGUE_ID, '', COLLEAGUE_ID, AUTHOR_ID],
      authorWorkspaceMemberId: AUTHOR_ID,
    });

    expect(result).toEqual({
      isValid: true,
      body: 'ping',
      mentionedWorkspaceMemberIds: [COLLEAGUE_ID],
    });
  });
});
