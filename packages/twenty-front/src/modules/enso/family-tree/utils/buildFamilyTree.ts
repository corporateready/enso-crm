import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';

// One family link as stored: `relationType` is what the related person is to
// `personId` (a row person=Ivan, relatedPerson=Maria, type=CHILD reads
// "Maria is Ivan's child"). Every link exists from both sides, so walking each
// person's own rows is enough to reach the whole family.
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

// `via` names the relative a member is reached through, when the generation
// alone doesn't say it: whose parent a grandparent is, or the one parent a
// half-sibling shares with the person.
export type FamilyMember = { id: string; displayName: string; via?: string[] };

export type FamilyTree = {
  grandparents: FamilyMember[];
  parents: FamilyMember[];
  inLaws: FamilyMember[];
  siblings: FamilyMember[];
  partners: FamilyMember[];
  children: FamilyMember[];
  grandchildren: FamilyMember[];
  others: FamilyMember[];
};

const PARTNER_TYPES = ['SPOUSE', 'PARTNER'];

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

const relatedOf = (
  links: FamilyLink[],
  personIds: Set<string>,
  relationTypes: string[],
): (FamilyMember & { throughId: string })[] =>
  links
    .filter(
      (link) =>
        isDefined(link.personId) &&
        personIds.has(link.personId) &&
        isDefined(link.relatedPersonId) &&
        isDefined(link.relationType) &&
        relationTypes.includes(link.relationType),
    )
    .map((link) => ({
      id: link.relatedPersonId as string,
      displayName: getDisplayName(link),
      throughId: link.personId as string,
    }));

// One entry per relative, remembering every person they were reached through.
const groupByRelative = (
  members: (FamilyMember & { throughId: string })[],
): (FamilyMember & { throughIds: string[] })[] => {
  const byId = new Map<string, FamilyMember & { throughIds: string[] }>();

  for (const { throughId, ...member } of members) {
    const existing = byId.get(member.id);

    if (isDefined(existing)) {
      existing.throughIds.push(throughId);
    } else {
      byId.set(member.id, { ...member, throughIds: [throughId] });
    }
  }

  return [...byId.values()];
};

export const getFirstGenerationIds = (
  personId: string,
  links: FamilyLink[],
): string[] => {
  const self = new Set([personId]);

  // Partners too, so their parents can be shown as in-laws.
  return [
    ...relatedOf(links, self, ['PARENT']),
    ...relatedOf(links, self, ['CHILD']),
    ...relatedOf(links, self, PARTNER_TYPES),
  ].map((member) => member.id);
};

// Three generations around one person: grandparents → parents and in-laws →
// the person with siblings and partners → children → grandchildren. `links`
// holds the person's own rows plus the rows of their parents, children and
// partners.
export const buildFamilyTree = (
  personId: string,
  links: FamilyLink[],
): FamilyTree => {
  const placed = new Set<string>([personId]);

  // A person reachable two ways (a sibling through a parent and through a
  // direct SIBLING link) is shown once, in the first generation reached.
  const place = (members: FamilyMember[]): FamilyMember[] =>
    members
      .filter((member) => {
        if (placed.has(member.id)) {
          return false;
        }

        placed.add(member.id);

        return true;
      })
      .map(({ id, displayName, via }) => ({
        id,
        displayName,
        ...(isDefined(via) && via.length > 0 ? { via } : {}),
      }));

  const self = new Set([personId]);

  const parents = place(relatedOf(links, self, ['PARENT']));
  const children = place(relatedOf(links, self, ['CHILD']));
  const partners = place(relatedOf(links, self, PARTNER_TYPES));

  const parentIds = new Set(parents.map((member) => member.id));
  const childIds = new Set(children.map((member) => member.id));

  const parentNames = new Map(
    parents.map((parent) => [parent.id, parent.displayName]),
  );
  const namesOf = (ids: string[]) =>
    ids.map((id) => parentNames.get(id)).filter(isNonEmptyString);

  // Siblings reached through only some of the person's parents are half
  // siblings; name the parent they share. With one known parent there is no
  // way to tell, so nothing is shown.
  const siblingsThroughParents = groupByRelative(
    relatedOf(links, parentIds, ['CHILD']),
  ).map(({ throughIds, ...sibling }) => ({
    ...sibling,
    ...(parents.length > 1 && throughIds.length < parents.length
      ? { via: namesOf(throughIds) }
      : {}),
  }));

  const siblings = place([
    ...siblingsThroughParents,
    ...relatedOf(links, self, ['SIBLING']),
  ]);

  const grandparents = place(
    groupByRelative(relatedOf(links, parentIds, ['PARENT'])).map(
      ({ throughIds, ...grandparent }) => ({
        ...grandparent,
        via: namesOf(throughIds),
      }),
    ),
  );
  const partnerNames = new Map(
    partners.map((partner) => [partner.id, partner.displayName]),
  );

  const inLaws = place(
    groupByRelative(
      relatedOf(links, new Set(partners.map((partner) => partner.id)), [
        'PARENT',
      ]),
    ).map(({ throughIds, ...inLaw }) => ({
      ...inLaw,
      via: throughIds
        .map((id) => partnerNames.get(id))
        .filter(isNonEmptyString),
    })),
  );
  const grandchildren = place(relatedOf(links, childIds, ['CHILD']));
  const others = place(relatedOf(links, self, ['OTHER']));

  return {
    grandparents,
    parents,
    inLaws,
    siblings,
    partners,
    children,
    grandchildren,
    others,
  };
};
