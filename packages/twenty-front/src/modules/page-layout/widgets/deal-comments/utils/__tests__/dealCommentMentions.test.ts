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

  it('should close once a space is typed after the name', () => {
    expect(findActiveMentionQuery('@ana ', 5)).toBeNull();
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
});
