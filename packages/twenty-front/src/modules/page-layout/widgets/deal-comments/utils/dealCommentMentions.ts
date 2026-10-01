import { type MentionableMember } from '@/page-layout/widgets/deal-comments/types/MentionableMember';

type ActiveMentionQuery = {
  query: string;
  start: number;
};

// The "@ana" being typed right before the caret, if any. An @ only starts a
// mention at the beginning of the text or after whitespace, so an email address
// typed into a comment does not open the picker.
export const findActiveMentionQuery = (
  text: string,
  caret: number,
): ActiveMentionQuery | null => {
  const beforeCaret = text.slice(0, caret);
  const match = /(^|\s)@([^\s@]*)$/.exec(beforeCaret);

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
  const normalizedQuery = query.trim().toLowerCase();

  return members.filter((member) =>
    member.name.toLowerCase().includes(normalizedQuery),
  );
};
