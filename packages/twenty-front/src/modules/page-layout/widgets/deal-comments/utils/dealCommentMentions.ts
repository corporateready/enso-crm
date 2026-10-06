import { type MentionableMember } from '@/page-layout/widgets/deal-comments/types/MentionableMember';

type ActiveMentionQuery = {
  query: string;
  start: number;
};

// Longer than any colleague's full name, so a stray @ earlier in a long
// sentence stops being treated as a mention in progress.
const MAX_MENTION_QUERY_LENGTH = 40;

// The "@ana pop" being typed right before the caret, if any. Names have spaces,
// so the query may too; the picker closes once it matches nobody (see
// filterMentionableMembers). An @ only starts a mention at the beginning of the
// text or after whitespace, so an email address does not open the picker.
export const findActiveMentionQuery = (
  text: string,
  caret: number,
): ActiveMentionQuery | null => {
  const beforeCaret = text.slice(0, caret);
  const match = new RegExp(
    `(^|\\s)@([^@\\n]{0,${MAX_MENTION_QUERY_LENGTH}})$`,
  ).exec(beforeCaret);

  if (match === null) {
    return null;
  }

  return {
    query: match[2],
    start: beforeCaret.length - match[2].length - 1,
  };
};

// Replaces the "@ana" being typed with the colleague's full name.
export const insertMention = ({
  text,
  start,
  caret,
  member,
}: {
  text: string;
  start: number;
  caret: number;
  member: MentionableMember;
}): { text: string; caret: number } => {
  const mentionText = `@${member.name} `;

  return {
    text: text.slice(0, start) + mentionText + text.slice(caret),
    caret: start + mentionText.length,
  };
};

// Someone picked from the list counts as mentioned only while their @name is
// still in the text — deleting it takes the mention back.
export const getMentionedMemberIds = (
  text: string,
  pickedMembers: MentionableMember[],
): string[] => [
  ...new Set(
    pickedMembers
      .filter((member) => text.includes(`@${member.name}`))
      .map((member) => member.id),
  ),
];

export const filterMentionableMembers = (
  members: MentionableMember[],
  query: string,
): MentionableMember[] => {
  // Only the leading space is dropped: a trailing one is meaningful. "ana "
  // still narrows towards "Ana Popescu", while the space typed after a
  // completed "@Ana Popescu" makes it match nobody, which closes the picker.
  const normalizedQuery = query.trimStart().toLowerCase();

  return members.filter((member) =>
    member.name.toLowerCase().includes(normalizedQuery),
  );
};
