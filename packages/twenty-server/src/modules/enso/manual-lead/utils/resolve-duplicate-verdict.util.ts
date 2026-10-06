import { isNonEmptyString } from '@sniptt/guards';

// One existing contact that shares the new lead's phone or email, seen from
// the project the lead is being added to.
export type DuplicateCandidate = {
  personId: string;
  createdAt: Date | null;
  // Who works this contact on this project: the active project assignment's
  // manager, else the owner of an open deal on the project. Null = nobody.
  projectOwnerId: string | null;
  hasOpenDealOnProject: boolean;
};

export type DuplicateVerdict =
  | { verdict: 'NEW' }
  | { verdict: 'BLOCKED'; personId: string; ownerMemberId: string }
  | { verdict: 'REUSE'; personId: string; hasOpenDealOnProject: boolean };

// Decides what adding the lead would do to the contacts already in the CRM.
// A contact someone else works on this project stays theirs — adding it again
// would hand the client a second manager — so that blocks. Otherwise the lead
// joins the existing contact instead of creating a duplicate the background
// merge would later fold into it anyway.
export const resolveDuplicateVerdict = (
  candidates: DuplicateCandidate[],
  viewerWorkspaceMemberId: string,
): DuplicateVerdict => {
  if (candidates.length === 0) {
    return { verdict: 'NEW' };
  }

  const ownedByOther = candidates.find(
    (candidate) =>
      isNonEmptyString(candidate.projectOwnerId) &&
      candidate.projectOwnerId !== viewerWorkspaceMemberId,
  );

  if (ownedByOther?.projectOwnerId) {
    return {
      verdict: 'BLOCKED',
      personId: ownedByOther.personId,
      ownerMemberId: ownedByOther.projectOwnerId,
    };
  }

  // The viewer's own contact first; otherwise the oldest, which is the one the
  // background merge would keep.
  const [chosen] = [...candidates].sort((first, second) => {
    const firstIsMine = first.projectOwnerId === viewerWorkspaceMemberId;
    const secondIsMine = second.projectOwnerId === viewerWorkspaceMemberId;

    if (firstIsMine !== secondIsMine) {
      return firstIsMine ? -1 : 1;
    }

    return (
      (first.createdAt?.getTime() ?? 0) - (second.createdAt?.getTime() ?? 0)
    );
  });

  return {
    verdict: 'REUSE',
    personId: chosen.personId,
    hasOpenDealOnProject: chosen.hasOpenDealOnProject,
  };
};
