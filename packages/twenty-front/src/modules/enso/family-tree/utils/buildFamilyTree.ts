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

export type FamilyMember = { id: string; displayName: string };

export type FamilyTree = {
  grandparents: FamilyMember[];
  parents: FamilyMember[];
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
): FamilyMember[] =>
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
    }));

export const getFirstGenerationIds = (
  personId: string,
  links: FamilyLink[],
): string[] => {
  const self = new Set([personId]);

  return [
    ...relatedOf(links, self, ['PARENT']),
    ...relatedOf(links, self, ['CHILD']),
  ].map((member) => member.id);
};

// Three generations around one person: grandparents → parents → the person
// with siblings and partners → children → grandchildren. `links` holds the
// person's own rows plus the rows of their parents and children.
export const buildFamilyTree = (
  personId: string,
  links: FamilyLink[],
): FamilyTree => {
  const placed = new Set<string>([personId]);

  // A person reachable two ways (a sibling through a parent and through a
  // direct SIBLING link) is shown once, in the first generation reached.
  const place = (members: FamilyMember[]): FamilyMember[] =>
    members.filter((member) => {
      if (placed.has(member.id)) {
        return false;
      }

      placed.add(member.id);

      return true;
    });

  const self = new Set([personId]);

  const parents = place(relatedOf(links, self, ['PARENT']));
  const children = place(relatedOf(links, self, ['CHILD']));
  const partners = place(relatedOf(links, self, PARTNER_TYPES));

  const parentIds = new Set(parents.map((member) => member.id));
  const childIds = new Set(children.map((member) => member.id));

  const siblings = place([
    ...relatedOf(links, self, ['SIBLING']),
    ...relatedOf(links, parentIds, ['CHILD']),
  ]);
  const grandparents = place(relatedOf(links, parentIds, ['PARENT']));
  const grandchildren = place(relatedOf(links, childIds, ['CHILD']));
  const others = place(relatedOf(links, self, ['OTHER']));

  return {
    grandparents,
    parents,
    siblings,
    partners,
    children,
    grandchildren,
    others,
  };
};
