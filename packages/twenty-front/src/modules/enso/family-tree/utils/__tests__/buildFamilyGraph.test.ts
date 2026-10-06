import {
  buildFamilyGraph,
  type FamilyLink,
} from '@/enso/family-tree/utils/buildFamilyGraph';
import {
  FAMILY_NODE_WIDTH,
  layoutFamilyGraph,
} from '@/enso/family-tree/utils/layoutFamilyGraph';

const link = (
  personId: string,
  relatedPersonId: string,
  relationType: string,
): FamilyLink => ({
  id: `${personId}-${relatedPersonId}`,
  personId,
  relatedPersonId,
  relationType,
  relatedPerson: { name: { firstName: relatedPersonId, lastName: '' } },
});

// Ion and Maria, each with their own parents, and Ion's brother Andrei.
// Only one side of each link is given: the graph must read both directions.
const popescu: FamilyLink[] = [
  link('ion', 'maria', 'SPOUSE'),
  link('ion', 'vasile', 'PARENT'),
  link('ion', 'elena', 'PARENT'),
  link('vasile', 'elena', 'SPOUSE'),
  link('vasile', 'andrei', 'CHILD'),
  link('elena', 'andrei', 'CHILD'),
  link('maria', 'gheorghe', 'PARENT'),
  link('maria', 'ana', 'PARENT'),
  link('gheorghe', 'ana', 'SPOUSE'),
];

const relationOf = (focusId: string, links: FamilyLink[]) =>
  Object.fromEntries(
    buildFamilyGraph(focusId, focusId, links).nodes.map((node) => [
      node.id,
      node.relation,
    ]),
  );

describe('buildFamilyGraph', () => {
  it('should name each relative relative to the person in focus', () => {
    expect(relationOf('ion', popescu)).toEqual({
      ion: 'self',
      maria: 'partner',
      vasile: 'parent',
      elena: 'parent',
      andrei: 'sibling',
      gheorghe: 'parentInLaw',
      ana: 'parentInLaw',
    });
  });

  it('should re-centre on another relative', () => {
    expect(relationOf('andrei', popescu)).toMatchObject({
      andrei: 'self',
      ion: 'sibling',
      maria: 'siblingInLaw',
      vasile: 'parent',
    });
  });

  it("should name a sibling's child a niece or nephew", () => {
    expect(
      relationOf('andrei', [...popescu, link('ion', 'sofia', 'CHILD')]).sofia,
    ).toBe('nieceOrNephew');
  });

  it('should mark a sibling who shares one parent as a half sibling', () => {
    expect(
      relationOf('ion', [
        link('ion', 'vasile', 'PARENT'),
        link('ion', 'elena', 'PARENT'),
        link('vasile', 'dan', 'CHILD'),
      ]).dan,
    ).toBe('halfSibling');
  });

  it('should ignore half-filled drafts and self-links', () => {
    expect(
      buildFamilyGraph('ion', 'ion', [
        { id: 'draft', personId: 'ion', relatedPersonId: 'maria' },
        link('ion', 'ion', 'SIBLING'),
      ]).nodes.map((node) => node.id),
    ).toEqual(['ion']);
  });

  it('should fall back to the stored label when the relative is not readable', () => {
    const graph = buildFamilyGraph('ion', 'Ion', [
      {
        id: 'hidden',
        name: 'Spouse · Maria Popescu',
        personId: 'ion',
        relatedPersonId: 'maria',
        relationType: 'SPOUSE',
        relatedPerson: null,
      },
    ]);

    expect(graph.nodes.find((node) => node.id === 'maria')?.displayName).toBe(
      'Maria Popescu',
    );
  });
});

describe('layoutFamilyGraph', () => {
  const layout = layoutFamilyGraph(
    'ion',
    buildFamilyGraph('ion', 'ion', popescu),
  );
  const at = (id: string) => {
    const node = layout.nodes.find((candidate) => candidate.id === id);

    if (!node) {
      throw new Error(`${id} not laid out`);
    }

    return node;
  };

  it('should put parents one row above their children', () => {
    expect(at('vasile').y).toBeLessThan(at('ion').y);
    expect(at('gheorghe').y).toBe(at('vasile').y);
    expect(at('andrei').y).toBe(at('ion').y);
  });

  it("should put each spouse's parents above that spouse", () => {
    expect(at('vasile').x).toBeLessThan(at('gheorghe').x);
    expect(at('ion').x).toBeLessThan(at('maria').x);
  });

  it('should keep couples side by side', () => {
    expect(Math.abs(at('vasile').x - at('elena').x)).toBeLessThanOrEqual(
      FAMILY_NODE_WIDTH + 40,
    );
    expect(Math.abs(at('ion').x - at('maria').x)).toBeLessThanOrEqual(
      FAMILY_NODE_WIDTH + 40,
    );
  });

  it('should not overlap cards in a row', () => {
    for (const rowY of new Set(layout.nodes.map((node) => node.y))) {
      const rowXs = layout.nodes
        .filter((node) => node.y === rowY)
        .map((node) => node.x)
        .sort((left, right) => left - right);

      rowXs.slice(1).forEach((x, index) => {
        expect(x - rowXs[index]).toBeGreaterThanOrEqual(FAMILY_NODE_WIDTH);
      });
    }
  });

  it("should hang Ion's brother from Ion's parents, not from Maria's", () => {
    const parentsCenter =
      (at('vasile').x + at('elena').x) / 2 + FAMILY_NODE_WIDTH / 2;
    const parentsLineY = at('vasile').y + 24;

    // The couple connector starts on the line between Vasile and Elena.
    expect(layout.paths).toContain(
      `M ${parentsCenter} ${parentsLineY} V ${at('ion').y - 32 - 8}`,
    );
  });
});
