import { isDefined } from 'twenty-shared/utils';

type MergedFamilyLink = {
  id: string;
  personId?: string | null;
  relatedPersonId?: string | null;
  mirrorOfId?: string | null;
  createdAt?: Date | string | null;
};

// After a person merge re-points both columns of every family link from the
// duplicate to the kept person, two kinds of row stop making sense:
// - a link between the duplicate and the kept person becomes a self-link;
// - if both had linked the same relative, that relative is now linked twice.
// Returns the ids to move to trash: every self-link, and for each pair linked
// more than once, all but the oldest link — each removed link together with
// its mirror, so the surviving link keeps both halves.
export const selectFamilyLinksToRemoveAfterMerge = (
  links: MergedFamilyLink[],
): string[] => {
  const toRemove = new Set<string>();

  for (const link of links) {
    if (isDefined(link.personId) && link.personId === link.relatedPersonId) {
      toRemove.add(link.id);
    }
  }

  const canonicalsByPair = new Map<string, MergedFamilyLink[]>();

  for (const link of links) {
    if (
      toRemove.has(link.id) ||
      isDefined(link.mirrorOfId) ||
      !isDefined(link.personId) ||
      !isDefined(link.relatedPersonId)
    ) {
      continue;
    }

    const pairKey = [link.personId, link.relatedPersonId].sort().join('|');

    canonicalsByPair.set(pairKey, [
      ...(canonicalsByPair.get(pairKey) ?? []),
      link,
    ]);
  }

  const createdTime = (link: MergedFamilyLink) =>
    new Date(link.createdAt ?? 0).getTime();

  for (const canonicals of canonicalsByPair.values()) {
    const [, ...extras] = [...canonicals].sort(
      (left, right) => createdTime(left) - createdTime(right),
    );

    for (const extra of extras) {
      toRemove.add(extra.id);

      for (const link of links) {
        if (link.mirrorOfId === extra.id) {
          toRemove.add(link.id);
        }
      }
    }
  }

  return [...toRemove];
};
