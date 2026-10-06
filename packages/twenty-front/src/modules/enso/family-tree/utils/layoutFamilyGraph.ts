import { isDefined } from 'twenty-shared/utils';

import {
  type FamilyGraph,
  type FamilyGraphNode,
} from '@/enso/family-tree/utils/buildFamilyGraph';

export const FAMILY_NODE_WIDTH = 168;
export const FAMILY_NODE_HEIGHT = 48;
const NODE_GAP = 28;
const ROW_GAP = 64;
const PADDING = 16;

export type PositionedFamilyNode = FamilyGraphNode & { x: number; y: number };

export type FamilyLayout = {
  nodes: PositionedFamilyNode[];
  // SVG path data: couple lines, and parent → children connectors.
  paths: string[];
  width: number;
  height: number;
};

const sortedKey = (ids: string[]) => [...ids].sort().join('|');

// Orders each generation so couples sit side by side and children sit under
// their own parents, then places them left to right. Rows are built outwards
// from the person in focus: their own row, then ancestors upwards, then
// descendants downwards.
export const layoutFamilyGraph = (
  focusId: string,
  graph: FamilyGraph,
): FamilyLayout => {
  const { nodes, parentsOf, partnersOf } = graph;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const generations = [...new Set(nodes.map((node) => node.generation))].sort(
    (left, right) => left - right,
  );

  const rows = new Map<number, string[]>();
  const placed = new Set<string>();

  const sameGeneration = (id: string, generation: number) =>
    byId.get(id)?.generation === generation;

  const childrenOf = (id: string) =>
    nodes
      .filter((node) => (parentsOf.get(node.id) ?? []).includes(id))
      .map((node) => node.id);

  const siblingsOf = (id: string) => {
    const parents = parentsOf.get(id) ?? [];

    return nodes
      .filter(
        (node) =>
          node.id !== id &&
          (parentsOf.get(node.id) ?? []).some((parentId) =>
            parents.includes(parentId),
          ),
      )
      .map((node) => node.id);
  };

  const pushWithPartners = (row: string[], id: string, generation: number) => {
    if (placed.has(id) || !sameGeneration(id, generation)) {
      return;
    }

    row.push(id);
    placed.add(id);

    for (const partnerId of partnersOf.get(id) ?? []) {
      if (!placed.has(partnerId) && sameGeneration(partnerId, generation)) {
        row.push(partnerId);
        placed.add(partnerId);
      }
    }
  };

  // Anyone left over in a row goes next to a sibling or partner already in it.
  const placeRemaining = (row: string[], generation: number) => {
    for (const node of nodes) {
      if (placed.has(node.id) || node.generation !== generation) {
        continue;
      }

      const anchorIndex = row.findIndex(
        (id) =>
          siblingsOf(node.id).includes(id) ||
          (partnersOf.get(node.id) ?? []).includes(id),
      );

      if (anchorIndex === -1) {
        row.push(node.id);
      } else if (anchorIndex < row.length / 2) {
        row.splice(anchorIndex, 0, node.id);
      } else {
        row.splice(anchorIndex + 1, 0, node.id);
      }

      placed.add(node.id);
    }
  };

  // The focus row: siblings, the person, then partners and their siblings.
  const focusRow: string[] = [];

  for (const siblingId of siblingsOf(focusId)) {
    if (sameGeneration(siblingId, 0) && !placed.has(siblingId)) {
      focusRow.push(siblingId);
      placed.add(siblingId);
    }
  }
  focusRow.push(focusId);
  placed.add(focusId);

  for (const partnerId of partnersOf.get(focusId) ?? []) {
    if (placed.has(partnerId)) {
      continue;
    }

    focusRow.push(partnerId);
    placed.add(partnerId);

    for (const siblingId of siblingsOf(partnerId)) {
      if (sameGeneration(siblingId, 0) && !placed.has(siblingId)) {
        focusRow.push(siblingId);
        placed.add(siblingId);
      }
    }
  }
  placeRemaining(focusRow, 0);
  rows.set(0, focusRow);

  for (const generation of generations.filter((value) => value < 0).reverse()) {
    const row: string[] = [];

    for (const childId of rows.get(generation + 1) ?? []) {
      for (const parentId of parentsOf.get(childId) ?? []) {
        pushWithPartners(row, parentId, generation);
      }
    }
    placeRemaining(row, generation);
    rows.set(generation, row);
  }

  for (const generation of generations.filter((value) => value > 0)) {
    const row: string[] = [];

    for (const parentId of rows.get(generation - 1) ?? []) {
      for (const childId of childrenOf(parentId)) {
        pushWithPartners(row, childId, generation);
      }
    }
    placeRemaining(row, generation);
    rows.set(generation, row);
  }

  // Place rows outwards from the focus row. Consecutive partners form a block
  // that is centred over (or under) the relatives connecting it to the row
  // already placed, without overlapping the block before it.
  const leftX = new Map<string, number>();
  const step = FAMILY_NODE_WIDTH + NODE_GAP;

  focusRow.forEach((id, index) => leftX.set(id, index * step));

  const placeRow = (
    generation: number,
    anchorsOf: (id: string) => string[],
  ) => {
    const row = rows.get(generation) ?? [];
    const blocks: string[][] = [];

    for (const id of row) {
      const lastBlock = blocks[blocks.length - 1];
      const previousId = lastBlock?.[lastBlock.length - 1];

      if (
        isDefined(previousId) &&
        (partnersOf.get(previousId) ?? []).includes(id)
      ) {
        lastBlock.push(id);
      } else {
        blocks.push([id]);
      }
    }

    let nextFreeLeft = Number.NEGATIVE_INFINITY;

    for (const block of blocks) {
      const anchorLefts = block
        .flatMap((id) => anchorsOf(id))
        .map((id) => leftX.get(id))
        .filter(isDefined);
      const blockWidth = block.length * step - NODE_GAP;
      const desiredLeft =
        anchorLefts.length > 0
          ? anchorLefts.reduce((sum, value) => sum + value, 0) /
              anchorLefts.length -
            blockWidth / 2 +
            FAMILY_NODE_WIDTH / 2
          : nextFreeLeft;
      const left = Math.max(
        Number.isFinite(desiredLeft) ? desiredLeft : 0,
        nextFreeLeft,
      );

      block.forEach((id, index) => leftX.set(id, left + index * step));
      nextFreeLeft = left + blockWidth + NODE_GAP;
    }
  };

  for (const generation of generations.filter((value) => value < 0).reverse()) {
    placeRow(generation, childrenOf);
  }
  for (const generation of generations.filter((value) => value > 0)) {
    placeRow(generation, (id) => parentsOf.get(id) ?? []);
  }

  const minX = Math.min(...[...leftX.values()]);
  const topGeneration = generations[0] ?? 0;
  const positioned: PositionedFamilyNode[] = nodes
    .filter((node) => leftX.has(node.id))
    .map((node) => ({
      ...node,
      x: (leftX.get(node.id) ?? 0) - minX + PADDING,
      y:
        (node.generation - topGeneration) * (FAMILY_NODE_HEIGHT + ROW_GAP) +
        PADDING,
    }));
  const positionOf = new Map(positioned.map((node) => [node.id, node]));

  const paths: string[] = [];

  // Couples: a line between partners standing side by side.
  for (const row of rows.values()) {
    for (let index = 0; index < row.length - 1; index++) {
      const left = positionOf.get(row[index]);
      const right = positionOf.get(row[index + 1]);

      if (
        isDefined(left) &&
        isDefined(right) &&
        (partnersOf.get(left.id) ?? []).includes(right.id)
      ) {
        const y = left.y + FAMILY_NODE_HEIGHT / 2;

        paths.push(`M ${left.x + FAMILY_NODE_WIDTH} ${y} H ${right.x}`);
      }
    }
  }

  // Parents → children: one connector per set of parents, so a half sibling
  // hangs from the one parent they share, not from the couple.
  const families = new Map<
    string,
    { parentIds: string[]; childIds: string[] }
  >();

  for (const node of positioned) {
    const parentIds = (parentsOf.get(node.id) ?? []).filter((id) =>
      positionOf.has(id),
    );

    if (parentIds.length === 0) {
      continue;
    }

    const key = sortedKey(parentIds);
    const family = families.get(key) ?? { parentIds, childIds: [] };

    family.childIds.push(node.id);
    families.set(key, family);
  }

  const busesPerRow = new Map<number, number>();

  for (const { parentIds, childIds } of families.values()) {
    const parents = parentIds.map((id) => positionOf.get(id)).filter(isDefined);
    const children = childIds.map((id) => positionOf.get(id)).filter(isDefined);

    if (parents.length === 0 || children.length === 0) {
      continue;
    }

    const parentCenters = parents.map(
      (parent) => parent.x + FAMILY_NODE_WIDTH / 2,
    );
    const originX =
      parentCenters.reduce((sum, value) => sum + value, 0) /
      parentCenters.length;
    // A couple's connector starts on the line between them; a single
    // parent's starts under their card.
    const originY =
      parents.length > 1
        ? parents[0].y + FAMILY_NODE_HEIGHT / 2
        : parents[0].y + FAMILY_NODE_HEIGHT;
    const childTop = children[0].y;
    const busIndex = busesPerRow.get(childTop) ?? 0;

    busesPerRow.set(childTop, busIndex + 1);

    // Stagger buses that share a gap so separate families don't merge.
    const busY = childTop - ROW_GAP / 2 + ((busIndex % 3) - 1) * 8;
    const childCenters = children.map(
      (child) => child.x + FAMILY_NODE_WIDTH / 2,
    );
    const busLeft = Math.min(originX, ...childCenters);
    const busRight = Math.max(originX, ...childCenters);

    paths.push(`M ${originX} ${originY} V ${busY}`);
    paths.push(`M ${busLeft} ${busY} H ${busRight}`);

    for (const childCenter of childCenters) {
      paths.push(`M ${childCenter} ${busY} V ${childTop}`);
    }
  }

  const width =
    Math.max(...positioned.map((node) => node.x + FAMILY_NODE_WIDTH), 0) +
    PADDING;
  const height =
    Math.max(...positioned.map((node) => node.y + FAMILY_NODE_HEIGHT), 0) +
    PADDING;

  return { nodes: positioned, paths, width, height };
};
