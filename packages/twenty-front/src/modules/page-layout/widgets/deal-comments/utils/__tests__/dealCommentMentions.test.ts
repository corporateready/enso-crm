import {
  filterMentionableMembers,
  findActiveMentionQuery,
  getMentionedMemberIds,
  insertMention,
} from '@/page-layout/widgets/deal-comments/utils/dealCommentMentions';

const ANA = { id: 'ana-id', name: 'Ana Popescu' };
const ION = { id: 'ion-id', name: 'Ion Rusu' };

describe('findActiveMentionQuery', () => {
  it('should find the mention being typed before the caret', () => {
    expect(findActiveMentionQuery('Ask @an', 7)).toEqual({
      query: 'an',
      start: 4,
    });
  });

  it('should open on a bare @ at the start of the text', () => {
    expect(findActiveMentionQuery('@', 1)).toEqual({ query: '', start: 0 });
  });

  it('should not treat an email address as a mention', () => {
    expect(findActiveMentionQuery('mail ana@enso.ro', 16)).toBeNull();
  });

  it('should keep a space inside the name being typed', () => {
    expect(findActiveMentionQuery('Ask @Ana Pop', 12)).toEqual({
      query: 'Ana Pop',
      start: 4,
    });
  });

  it('should stop at a line break', () => {
    expect(findActiveMentionQuery('@Ana\nnext line', 14)).toBeNull();
  });

  it('should give up on an @ far back in a long sentence', () => {
    const text = `@${'a'.repeat(41)}`;

    expect(findActiveMentionQuery(text, text.length)).toBeNull();
  });
});

describe('insertMention', () => {
  it('should replace the typed query with the full name and move the caret', () => {
    expect(
      insertMention({
        text: 'Ask @an please',
        start: 4,
        caret: 7,
        member: ANA,
      }),
    ).toEqual({ text: 'Ask @Ana Popescu  please', caret: 17 });
  });
});

describe('getMentionedMemberIds', () => {
  it('should keep only colleagues whose @name is still in the text', () => {
    expect(
      getMentionedMemberIds('@Ana Popescu check this', [ANA, ION]),
    ).toEqual(['ana-id']);
  });

  it('should return nothing when every mention was deleted', () => {
    expect(getMentionedMemberIds('check this', [ANA])).toEqual([]);
  });
});

describe('filterMentionableMembers', () => {
  it('should match any part of the name, ignoring case', () => {
    expect(filterMentionableMembers([ANA, ION], 'rus')).toEqual([ION]);
  });

  it('should narrow by first and last name together', () => {
    expect(filterMentionableMembers([ANA, ION], 'ana pop')).toEqual([ANA]);
  });

  it('should keep matching while the space after a first name is typed', () => {
    expect(filterMentionableMembers([ANA, ION], 'ana ')).toEqual([ANA]);
  });

  it('should match nobody once a completed mention is followed by a space', () => {
    expect(filterMentionableMembers([ANA, ION], 'Ana Popescu ')).toEqual([]);
  });
});
