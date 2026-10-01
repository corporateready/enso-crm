import { isDefined } from 'twenty-shared/utils';

// Every family link is stored twice, once from each person's side: the
// canonical row (mirrorOfId = null) and its mirror (mirrorOfId = canonical.id).
// Either row may be the one a manager edits, so whichever row changed decides
// what its partner must look like.
export type RelationshipRow = {
  id: string;
  personId?: string | null;
  relatedPersonId?: string | null;
  relationType?: string | null;
  mirrorOfId?: string | null;
  deletedAt?: Date | string | null;
};

export type PartnerFields = {
  personId: string;
  relatedPersonId: string;
  relationType: string;
};

export type PartnerSyncPlan =
  // A half-filled draft that never became a link: nothing to mirror yet.
  | { kind: 'none' }
  | { kind: 'create'; fields: PartnerFields; promoteSelf: boolean }
  | { kind: 'update'; partnerId: string; fields: PartnerFields }
  // The row stopped being a complete link, so the other side must go. When
  // the subject person was removed (Detach), the row itself is meaningless too.
  | { kind: 'remove'; partnerId: string; removeSelf: boolean };

// Symmetric types map to themselves; asymmetric (CHILD/PARENT) invert.
const INVERSE_RELATION_TYPE: Record<string, string> = {
  SPOUSE: 'SPOUSE',
  PARTNER: 'PARTNER',
  SIBLING: 'SIBLING',
  OTHER: 'OTHER',
  CHILD: 'PARENT',
  PARENT: 'CHILD',
};

export const inverseRelationType = (relationType: string): string =>
  INVERSE_RELATION_TYPE[relationType] ?? relationType;

export const isCompleteLink = (
  row: RelationshipRow,
): row is RelationshipRow & PartnerFields =>
  isDefined(row.personId) &&
  isDefined(row.relatedPersonId) &&
  isDefined(row.relationType);

export const planPartnerSync = (
  row: RelationshipRow,
  partner: RelationshipRow | null,
): PartnerSyncPlan => {
  if (!isCompleteLink(row)) {
    if (!isDefined(partner)) {
      return { kind: 'none' };
    }

    return {
      kind: 'remove',
      partnerId: partner.id,
      removeSelf: !isDefined(row.personId),
    };
  }

  const fields: PartnerFields = {
    personId: row.relatedPersonId,
    relatedPersonId: row.personId,
    relationType: inverseRelationType(row.relationType),
  };

  if (!isDefined(partner)) {
    // A mirror whose canonical is gone becomes the canonical of a new pair.
    return { kind: 'create', fields, promoteSelf: isDefined(row.mirrorOfId) };
  }

  return { kind: 'update', partnerId: partner.id, fields };
};

export const partnerNeedsUpdate = (
  partner: RelationshipRow,
  fields: PartnerFields,
): boolean =>
  partner.personId !== fields.personId ||
  partner.relatedPersonId !== fields.relatedPersonId ||
  partner.relationType !== fields.relationType;

export type LinkValidationError = 'SELF_LINK' | 'DUPLICATE_LINK';

// A link is rejected when it points a person at themselves, or when the two
// people are already linked from either side. The row's own partner is the
// other half of the same link, not a duplicate.
export const findLinkValidationError = (
  candidate: Pick<RelationshipRow, 'personId' | 'relatedPersonId'> & {
    id?: string;
    mirrorOfId?: string | null;
  },
  existingLinksBetweenThePair: RelationshipRow[],
): LinkValidationError | undefined => {
  if (!isDefined(candidate.personId) || !isDefined(candidate.relatedPersonId)) {
    return undefined;
  }

  if (candidate.personId === candidate.relatedPersonId) {
    return 'SELF_LINK';
  }

  const isOwnHalf = (row: RelationshipRow) =>
    isDefined(candidate.id) &&
    (row.id === candidate.id ||
      row.mirrorOfId === candidate.id ||
      row.id === candidate.mirrorOfId);

  const isSamePair = (row: RelationshipRow) =>
    (row.personId === candidate.personId &&
      row.relatedPersonId === candidate.relatedPersonId) ||
    (row.personId === candidate.relatedPersonId &&
      row.relatedPersonId === candidate.personId);

  const duplicate = existingLinksBetweenThePair.find(
    (row) => isSamePair(row) && !isOwnHalf(row) && !isDefined(row.deletedAt),
  );

  return isDefined(duplicate) ? 'DUPLICATE_LINK' : undefined;
};
