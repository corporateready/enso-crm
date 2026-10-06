import { selectFamilyLinksToRemoveAfterMerge } from 'src/modules/enso/person-relationship/utils/select-family-links-to-remove-after-merge.util';

// Ana is kept; Ana-duplicate was merged into her, so every link that pointed
// at the duplicate now points at Ana.
describe('selectFamilyLinksToRemoveAfterMerge', () => {
  it('should remove a link between the merged person and the kept person', () => {
    expect(
      selectFamilyLinksToRemoveAfterMerge([
        { id: 'self', personId: 'ana', relatedPersonId: 'ana' },
        {
          id: 'self-mirror',
          personId: 'ana',
          relatedPersonId: 'ana',
          mirrorOfId: 'self',
        },
      ]).sort(),
    ).toEqual(['self', 'self-mirror']);
  });

  it('should keep the oldest link when both linked the same relative', () => {
    expect(
      selectFamilyLinksToRemoveAfterMerge([
        {
          id: 'old',
          personId: 'ana',
          relatedPersonId: 'ion',
          createdAt: '2026-01-01',
        },
        {
          id: 'old-mirror',
          personId: 'ion',
          relatedPersonId: 'ana',
          mirrorOfId: 'old',
        },
        {
          id: 'new',
          personId: 'ion',
          relatedPersonId: 'ana',
          createdAt: '2026-05-01',
        },
        {
          id: 'new-mirror',
          personId: 'ana',
          relatedPersonId: 'ion',
          mirrorOfId: 'new',
        },
      ]).sort(),
    ).toEqual(['new', 'new-mirror']);
  });

  it('should leave links to different relatives alone', () => {
    expect(
      selectFamilyLinksToRemoveAfterMerge([
        { id: 'spouse', personId: 'ana', relatedPersonId: 'ion' },
        { id: 'child', personId: 'ana', relatedPersonId: 'sofia' },
      ]),
    ).toEqual([]);
  });
});
