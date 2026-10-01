type CommentPart = { text: string; isMention: boolean };

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Picks the "@Ana Popescu" runs out of a comment so they can be highlighted.
// Longest names first, so "@Ana Popescu" wins over a colleague called "Ana".
export const splitCommentIntoMentionParts = (
  body: string,
  memberNames: string[],
): CommentPart[] => {
  const names = [...new Set(memberNames.filter((name) => name !== ''))].sort(
    (first, second) => second.length - first.length,
  );

  if (names.length === 0) {
    return [{ text: body, isMention: false }];
  }

  const pattern = new RegExp(`(@(?:${names.map(escapeRegExp).join('|')}))`);

  return body
    .split(pattern)
    .filter((text) => text !== '')
    .map((text) => ({ text, isMention: pattern.test(text) }));
};
