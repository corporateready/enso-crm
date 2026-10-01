import {
  buildFamilyTree,
  type FamilyLink,
  getFirstGenerationIds,
} from '@/enso/family-tree/utils/buildFamilyTree';

const link = (
  personId: string,
  relatedPersonId: string,
  relationType: string,
): FamilyLink => ({
  id: `${personId}-${relatedPersonId}`,
  personId,
  relatedPersonId,
  relationType,
  relatedPerson: { name: { firstName: relatedPersonId, lastName: 'Vasiliev' } },
});

const names = (members: { displayName: string }[]) =>
  members.map((member) => member.displayName);

describe('buildFamilyTree', () => {
  const links: FamilyLink[] = [
    link('ivan', 'petru', 'PARENT'),
    link('ivan', 'maria', 'SPOUSE'),
    link('ivan', 'ana', 'CHILD'),
    link('ivan', 'olga', 'SIBLING'),
    link('petru', 'vasile', 'PARENT'),
    link('petru', 'ivan', 'CHILD'),
    link('petru', 'olga', 'CHILD'),
    link('petru', 'dan', 'CHILD'),
    link('ana', 'ivan', 'PARENT'),
    link('ana', 'luca', 'CHILD'),
  ];

  it('should place each relative in their generation', () => {
    const tree = buildFamilyTree('ivan', links);

    expect(names(tree.grandparents)).toEqual(['vasile Vasiliev']);
    expect(names(tree.parents)).toEqual(['petru Vasiliev']);
    expect(names(tree.partners)).toEqual(['maria Vasiliev']);
    expect(names(tree.children)).toEqual(['ana Vasiliev']);
    expect(names(tree.grandchildren)).toEqual(['luca Vasiliev']);
  });

  it('should find siblings through parents and show each sibling once', () => {
    expect(names(buildFamilyTree('ivan', links).siblings)).toEqual([
      'olga Vasiliev',
      'dan Vasiliev',
    ]);
  });

  it('should fall back to the stored label when the relative is not readable', () => {
    const tree = buildFamilyTree('ivan', [
      {
        id: 'hidden',
        name: 'Spouse · Maria Popescu',
        personId: 'ivan',
        relatedPersonId: 'maria',
        relationType: 'SPOUSE',
        relatedPerson: null,
      },
    ]);

    expect(names(tree.partners)).toEqual(['Maria Popescu']);
  });

  it('should ignore half-filled drafts', () => {
    const tree = buildFamilyTree('ivan', [
      { id: 'draft', personId: 'ivan', relatedPersonId: null },
    ]);

    expect(Object.values(tree).flat()).toEqual([]);
  });
});

describe('buildFamilyTree connections', () => {
  const twoParents: FamilyLink[] = [
    link('ivan', 'petru', 'PARENT'),
    link('ivan', 'elena', 'PARENT'),
    link('petru', 'vasile', 'PARENT'),
    link('elena', 'nina', 'PARENT'),
    link('petru', 'olga', 'CHILD'),
    link('elena', 'olga', 'CHILD'),
    link('petru', 'dan', 'CHILD'),
  ];

  it('should say whose parent each grandparent is', () => {
    const tree = buildFamilyTree('ivan', twoParents);

    expect(tree.grandparents).toEqual([
      expect.objectContaining({
        displayName: 'vasile Vasiliev',
        via: ['petru Vasiliev'],
      }),
      expect.objectContaining({
        displayName: 'nina Vasiliev',
        via: ['elena Vasiliev'],
      }),
    ]);
  });

  it('should name the shared parent only for a half-sibling', () => {
    const tree = buildFamilyTree('ivan', twoParents);
    const viaByName = Object.fromEntries(
      tree.siblings.map((sibling) => [sibling.displayName, sibling.via]),
    );

    expect(viaByName['olga Vasiliev']).toBeUndefined();
    expect(viaByName['dan Vasiliev']).toEqual(['petru Vasiliev']);
  });
});

describe('buildFamilyTree in-laws', () => {
  it("should show the partner's parents as in-laws", () => {
    const tree = buildFamilyTree('ion', [
      link('ion', 'maria', 'SPOUSE'),
      link('ion', 'petru', 'PARENT'),
      link('maria', 'ion', 'SPOUSE'),
      link('maria', 'gheorghe', 'PARENT'),
      link('maria', 'ana', 'PARENT'),
    ]);

    expect(names(tree.parents)).toEqual(['petru Vasiliev']);
    expect(tree.inLaws).toEqual([
      expect.objectContaining({
        displayName: 'gheorghe Vasiliev',
        via: ['maria Vasiliev'],
      }),
      expect.objectContaining({
        displayName: 'ana Vasiliev',
        via: ['maria Vasiliev'],
      }),
    ]);
  });
});

describe('getFirstGenerationIds', () => {
  it('should return parents, children and partners', () => {
    expect(
      getFirstGenerationIds('ivan', [
        link('ivan', 'petru', 'PARENT'),
        link('ivan', 'ana', 'CHILD'),
        link('ivan', 'maria', 'SPOUSE'),
      ]),
    ).toEqual(['petru', 'ana', 'maria']);
  });
});
