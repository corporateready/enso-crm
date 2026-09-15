import { isDefined } from 'twenty-shared/utils';

type GetViewIdParams = {
  viewIdFromQueryParams: string | null;
  personalDefaultViewId?: string;
  indexViewId?: string;
  lastVisitedViewId?: string;
  firstAvailableViewId?: string;
  roleDefaultViewId?: string;
  // True when this person has not yet been landed on their role's default for
  // this object at its current version.
  shouldSeedRoleDefaultView?: boolean;
};

// The one place that decides which view an object opens on.
//
// An explicit choice in the URL always wins. Then this person's OWN default,
// which out-ranks everything below because they set it deliberately — a role
// default is inherited, and an inherited setting should not override a chosen
// one. Then a role default they have not been shown yet at its current
// version, which is what lets a newly configured default reach members who
// already have a last-visited view. Then wherever they were last, their role's
// default, and the workspace INDEX view.
//
// After that one seeding the role default stops out-ranking last-visited, so it
// stays a starting point rather than a cage: someone who deliberately switches
// to another view keeps it.
export const getViewId = ({
  viewIdFromQueryParams,
  personalDefaultViewId,
  indexViewId,
  lastVisitedViewId,
  firstAvailableViewId,
  roleDefaultViewId,
  shouldSeedRoleDefaultView,
}: GetViewIdParams) => {
  if (isDefined(viewIdFromQueryParams)) {
    return viewIdFromQueryParams;
  }

  if (isDefined(personalDefaultViewId)) {
    return personalDefaultViewId;
  }

  if (shouldSeedRoleDefaultView === true && isDefined(roleDefaultViewId)) {
    return roleDefaultViewId;
  }

  if (isDefined(lastVisitedViewId)) {
    return lastVisitedViewId;
  }

  if (isDefined(roleDefaultViewId)) {
    return roleDefaultViewId;
  }

  if (isDefined(indexViewId)) {
    return indexViewId;
  }

  if (isDefined(firstAvailableViewId)) {
    return firstAvailableViewId;
  }

  return undefined;
};
