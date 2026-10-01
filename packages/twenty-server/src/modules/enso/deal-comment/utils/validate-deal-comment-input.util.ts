import { isNonEmptyString } from '@sniptt/guards';

import { DEAL_COMMENT_MAX_BODY_LENGTH } from 'src/modules/enso/deal-comment/deal-comment.constants';

type ValidateDealCommentInputArgs = {
  body: string | null | undefined;
  mentionedWorkspaceMemberIds: string[] | null | undefined;
  authorWorkspaceMemberId: string;
};

export type ValidatedDealCommentInput =
  | { isValid: true; body: string; mentionedWorkspaceMemberIds: string[] }
  | { isValid: false; error: string };

// A comment is the deal's free-text thread: a manager's own summary or
// thoughts, or a question to a colleague. Mentions are optional; mentioning
// yourself is dropped, since it would notify no one.
export const validateDealCommentInput = ({
  body,
  mentionedWorkspaceMemberIds,
  authorWorkspaceMemberId,
}: ValidateDealCommentInputArgs): ValidatedDealCommentInput => {
  const trimmedBody = (body ?? '').trim();

  if (trimmedBody === '') {
    return { isValid: false, error: 'The comment is empty.' };
  }

  if (trimmedBody.length > DEAL_COMMENT_MAX_BODY_LENGTH) {
    return {
      isValid: false,
      error: `The comment is longer than ${DEAL_COMMENT_MAX_BODY_LENGTH} characters.`,
    };
  }

  const mentionedIds = [
    ...new Set(
      (mentionedWorkspaceMemberIds ?? []).filter(
        (workspaceMemberId) =>
          isNonEmptyString(workspaceMemberId) &&
          workspaceMemberId !== authorWorkspaceMemberId,
      ),
    ),
  ];

  return {
    isValid: true,
    body: trimmedBody,
    mentionedWorkspaceMemberIds: mentionedIds,
  };
};
