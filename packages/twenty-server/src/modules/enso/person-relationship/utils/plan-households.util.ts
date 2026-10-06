import { isDefined } from 'twenty-shared/utils';

// A household is everyone connected to each other through family links (a
// couple, both sets of parents, siblings, children…). The links are the
// source of truth; households are derived from them and kept in step.

export type HouseholdCandidate = {
  id: string;
  householdId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  createdAt?: Date | string | null;
};

export type HouseholdPlan = {
  // Households to create, each named and given its members.
  create: { name: string; memberIds: string[] }[];
  // Existing households whose member list changes.
  assign: { householdId: string; memberIds: string[] }[];
  // People who are in no family any more.
  clear: string[];
  // Households left with nobody in them.
  remove: string[];
};

const createdTime = (person: HouseholdCandidate) =>
  new Date(person.createdAt ?? 0).getTime();

// "<Last name> Family": the most common last name among the members, ties
// going to the longest-known contact (usually the client the family grew
// around). Managers can rename it; existing names are never touched.
export const buildHouseholdName = (members: HouseholdCandidate[]): string => {
  const counts = new Map<string, { count: number; firstSeen: number }>();

  for (const member of members) {
    const lastName = (member.lastName ?? '').trim();

    if (lastName.length === 0) {
      continue;
    }

    const entry = counts.get(lastName);

    counts.set(lastName, {
      count: (entry?.count ?? 0) + 1,
      firstSeen: Math.min(entry?.firstSeen ?? Infinity, createdTime(member)),
    });
  }

  const [best] = [...counts.entries()].sort(
    ([, left], [, right]) =>
      right.count - left.count || left.firstSeen - right.firstSeen,
  );

  if (isDefined(best)) {
    return `${best[0]} Family`;
  }

  const [oldest] = [...members].sort(
    (left, right) => createdTime(left) - createdTime(right),
  );
  const firstName = (oldest?.firstName ?? '').trim();

  return firstName.length > 0 ? `${firstName}'s Family` : 'Family';
};

// Given the connected groups of people (size ≥ 2 = a family; size 1 = no
// family) decide which household each group gets. A group keeps the
// household most of its members already have, so households survive edits
// and keep their manual names; when a family splits, the larger part keeps
// it and the rest get a new one. Larger groups choose first.
export const planHouseholds = (
  groups: HouseholdCandidate[][],
  // Households touched by these groups that may end up empty.
  previouslyUsedHouseholdIds: string[] = [],
): HouseholdPlan => {
  const plan: HouseholdPlan = { create: [], assign: [], clear: [], remove: [] };
  const claimed = new Set<string>();

  const ordered = [...groups].sort((left, right) => right.length - left.length);

  for (const group of ordered) {
    if (group.length < 2) {
      for (const person of group) {
        if (isDefined(person.householdId)) {
          plan.clear.push(person.id);
        }
      }
      continue;
    }

    const votes = new Map<string, number>();

    for (const person of group) {
      if (isDefined(person.householdId) && !claimed.has(person.householdId)) {
        votes.set(person.householdId, (votes.get(person.householdId) ?? 0) + 1);
      }
    }

    const [winner] = [...votes.entries()].sort(
      ([leftId, left], [rightId, right]) =>
        right - left || leftId.localeCompare(rightId),
    );

    if (!isDefined(winner)) {
      plan.create.push({
        name: buildHouseholdName(group),
        memberIds: group.map((person) => person.id),
      });
      continue;
    }

    const [householdId] = winner;

    claimed.add(householdId);

    const movingIds = group
      .filter((person) => person.householdId !== householdId)
      .map((person) => person.id);

    if (movingIds.length > 0) {
      plan.assign.push({ householdId, memberIds: movingIds });
    }
  }

  const stillUsed = new Set(claimed);
  const allUsed = new Set([
    ...previouslyUsedHouseholdIds,
    ...groups
      .flat()
      .map((person) => person.householdId)
      .filter(isDefined),
  ]);

  plan.remove = [...allUsed].filter((id) => !stillUsed.has(id));

  return plan;
};

// Splits people into connected groups along the given links.
export const groupConnectedPeople = (
  personIds: string[],
  links: { personId: string; relatedPersonId: string }[],
): string[][] => {
  const neighbours = new Map<string, Set<string>>();

  const connect = (from: string, to: string) => {
    neighbours.set(from, (neighbours.get(from) ?? new Set()).add(to));
  };

  for (const { personId, relatedPersonId } of links) {
    if (personId === relatedPersonId) {
      continue;
    }

    connect(personId, relatedPersonId);
    connect(relatedPersonId, personId);
  }

  const seen = new Set<string>();
  const groups: string[][] = [];

  for (const start of personIds) {
    if (seen.has(start)) {
      continue;
    }

    const group: string[] = [];
    const queue = [start];

    seen.add(start);

    while (queue.length > 0) {
      const current = queue.shift() as string;

      group.push(current);

      for (const next of neighbours.get(current) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }

    groups.push(group);
  }

  return groups;
};
