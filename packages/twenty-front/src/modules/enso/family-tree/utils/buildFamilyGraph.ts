import { isDefined } from 'twenty-shared/utils';

// One family link as stored: `relationType` is what the related person is to
// `personId` (a row person=Ivan, relatedPerson=Maria, type=CHILD reads
// "Maria is Ivan's child"). Links normally exist from both sides; a scoped
// manager may see only one, so every row is read in both directions.
export type FamilyLink = {
  id: string;
  name?: string | null;
  personId?: string | null;
  relatedPersonId?: string | null;
  relationType?: string | null;
  relatedPerson?: {
    name?: { firstName?: string | null; lastName?: string | null } | null;
  } | null;
};

export type FamilyRelation =
  | 'self'
  | 'parent'
  | 'grandparent'
  | 'sibling'
  | 'halfSibling'
  | 'partner'
  | 'child'
  | 'grandchild'
  | 'parentInLaw'
  | 'siblingInLaw'
  | 'childInLaw'
  | 'auntOrUncle'
  | 'stepParent'
  | 'stepChild'
  | 'nieceOrNephew'
  | 'relative';

export type FamilyGraphNode = {
  id: string;
  displayName: string;
  generation: number;
  relation: FamilyRelation;
};

export type FamilyGraph = {
  nodes: FamilyGraphNode[];
  // Each person's parents and partners among the shown nodes.
  parentsOf: Map<string, string[]>;
  partnersOf: Map<string, string[]>;
};

type Edge = { to: string; type: string };

const PARTNER_TYPES = ['SPOUSE', 'PARTNER'];
const INVERSE_TYPE: Record<string, string> = {
  PARENT: 'CHILD',
  CHILD: 'PARENT',
  SPOUSE: 'SPOUSE',
  PARTNER: 'PARTNER',
  SIBLING: 'SIBLING',
  OTHER: 'OTHER',
};
const GENERATION_STEP: Record<string, number> = { PARENT: -1, CHILD: 1 };

// How far from the person in focus the tree reaches.
const MAX_HOPS = 3;
const MAX_GENERATION_DISTANCE = 2;

// The related person may be outside a scoped manager's book, in which case the
// relation resolves to null; the stored label ("Spouse · Maria Popescu") still
// carries the name.
const getDisplayName = (link: FamilyLink): string => {
  const firstName = link.relatedPerson?.name?.firstName ?? '';
  const lastName = link.relatedPerson?.name?.lastName ?? '';
  const fullName = `${firstName} ${lastName}`.trim();

  if (fullName.length > 0) {
    return fullName;
  }

  const labelParts = (link.name ?? '').split(' · ');

  return labelParts.length > 1 ? labelParts.slice(1).join(' · ') : '';
};

const normalizeType = (type: string) =>
  PARTNER_TYPES.includes(type) ? 'PARTNER' : type;

// The shortest path of link types from the person in focus names the kinship.
const relationFromPath = (path: string[]): FamilyRelation => {
  const key = path.map(normalizeType).join('>');

  switch (key) {
    case '':
      return 'self';
    case 'PARENT':
      return 'parent';
    case 'PARENT>PARENT':
      return 'grandparent';
    case 'SIBLING':
    case 'PARENT>CHILD':
      return 'sibling';
    case 'PARTNER':
      return 'partner';
    case 'CHILD':
      return 'child';
    case 'CHILD>CHILD':
      return 'grandchild';
    case 'PARTNER>PARENT':
      return 'parentInLaw';
    case 'PARTNER>SIBLING':
    case 'SIBLING>PARTNER':
    case 'PARTNER>PARENT>CHILD':
    case 'PARENT>CHILD>PARTNER':
      return 'siblingInLaw';
    case 'CHILD>PARTNER':
      return 'childInLaw';
    case 'PARENT>SIBLING':
    case 'PARENT>PARENT>CHILD':
      return 'auntOrUncle';
    case 'PARENT>PARTNER':
      return 'stepParent';
    case 'PARTNER>CHILD':
      return 'stepChild';
    case 'SIBLING>CHILD':
    case 'PARENT>CHILD>CHILD':
      return 'nieceOrNephew';
    default:
      return 'relative';
  }
};

export const buildFamilyGraph = (
  focusId: string,
  focusName: string,
  links: FamilyLink[],
): FamilyGraph => {
  const adjacency = new Map<string, Edge[]>();
  const names = new Map<string, string>([[focusId, focusName]]);

  const addEdge = (from: string, to: string, type: string) => {
    const edges = adjacency.get(from) ?? [];

    if (!edges.some((edge) => edge.to === to && edge.type === type)) {
      edges.push({ to, type });
    }

    adjacency.set(from, edges);
  };

  for (const link of links) {
    if (
      !isDefined(link.personId) ||
      !isDefined(link.relatedPersonId) ||
      !isDefined(link.relationType) ||
      link.personId === link.relatedPersonId
    ) {
      continue;
    }

    addEdge(link.personId, link.relatedPersonId, link.relationType);
    addEdge(
      link.relatedPersonId,
      link.personId,
      INVERSE_TYPE[link.relationType] ?? link.relationType,
    );

    const displayName = getDisplayName(link);

    if (displayName.length > 0 && !names.has(link.relatedPersonId)) {
      names.set(link.relatedPersonId, displayName);
    }
  }

  // Breadth-first from the person in focus, so each relative keeps the
  // shortest path (and so the plainest kinship) that reaches them.
  const reached = new Map<string, { generation: number; path: string[] }>([
    [focusId, { generation: 0, path: [] }],
  ]);
  let frontier = [focusId];

  for (let hop = 0; hop < MAX_HOPS && frontier.length > 0; hop++) {
    const next: string[] = [];

    for (const personId of frontier) {
      const current = reached.get(personId);

      if (!isDefined(current)) {
        continue;
      }

      for (const edge of adjacency.get(personId) ?? []) {
        // "Other relative" has no place in a generation; show it only for
        // the person in focus.
        if (edge.type === 'OTHER' && personId !== focusId) {
          continue;
        }

        const generation =
          current.generation + (GENERATION_STEP[edge.type] ?? 0);

        if (
          reached.has(edge.to) ||
          Math.abs(generation) > MAX_GENERATION_DISTANCE
        ) {
          continue;
        }

        reached.set(edge.to, {
          generation,
          path: [...current.path, edge.type],
        });
        next.push(edge.to);
      }
    }

    frontier = next;
  }

  const shown = new Set(reached.keys());
  const parentsOf = new Map<string, string[]>();
  const partnersOf = new Map<string, string[]>();

  for (const personId of shown) {
    const edges = adjacency.get(personId) ?? [];

    parentsOf.set(
      personId,
      edges
        .filter((edge) => edge.type === 'PARENT' && shown.has(edge.to))
        .map((edge) => edge.to),
    );
    partnersOf.set(
      personId,
      edges
        .filter(
          (edge) => PARTNER_TYPES.includes(edge.type) && shown.has(edge.to),
        )
        .map((edge) => edge.to),
    );
  }

  const focusParents = new Set(parentsOf.get(focusId) ?? []);

  const nodes = [...reached.entries()].map(([id, { generation, path }]) => {
    let relation = relationFromPath(path);

    // A sibling who shares only some of the known parents is a half sibling.
    if (relation === 'sibling' && focusParents.size > 1) {
      const sharedParents = (parentsOf.get(id) ?? []).filter((parentId) =>
        focusParents.has(parentId),
      );

      if (
        sharedParents.length > 0 &&
        sharedParents.length < focusParents.size
      ) {
        relation = 'halfSibling';
      }
    }

    return {
      id,
      displayName: names.get(id) ?? '',
      generation,
      relation,
    };
  });

  return { nodes, parentsOf, partnersOf };
};
