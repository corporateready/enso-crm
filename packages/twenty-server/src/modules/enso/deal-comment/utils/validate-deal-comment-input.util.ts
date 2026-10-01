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

// A comment is internal discussion, so it has to be addressed to somebody.
// Mentioning yourself does not count: it would notify no one.
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

  if (mentionedIds.length === 0) {
    return {
      isValid: false,
      error: 'Mention at least one colleague with @ to post a comment.',
    };
  }

  return {
    isValid: true,
    body: trimmedBody,
    mentionedWorkspaceMemberIds: mentionedIds,
  };
};
