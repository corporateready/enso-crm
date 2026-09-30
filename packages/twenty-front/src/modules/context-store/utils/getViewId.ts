import { isDefined } from 'twenty-shared/utils';

type GetViewIdParams = {
  viewIdFromQueryParams: string | null;
  personalDefaultViewId?: string;
  indexViewId?: string;
  lastVisitedViewId?: string;
  firstAvailableViewId?: string;
  roleDefaultViewId?: string;
};

// The one place that decides which view an object opens on.
//
// An explicit choice in the URL always wins — that is how switching views
// within a visit works. Then this person's OWN default, set deliberately with
// "Set as my default". Then their role's default, which out-ranks wherever they
// were last: opening the object from the sidebar lands a manager back on the
// role's view every time until they pin a view of their own. Last-visited only
// matters for roles without a default. Then the workspace INDEX view.
export const getViewId = ({
  viewIdFromQueryParams,
  personalDefaultViewId,
  indexViewId,
  lastVisitedViewId,
  firstAvailableViewId,
  roleDefaultViewId,
}: GetViewIdParams) => {
  if (isDefined(viewIdFromQueryParams)) {
    return viewIdFromQueryParams;
  }

  if (isDefined(personalDefaultViewId)) {
    return personalDefaultViewId;
  }

  if (isDefined(roleDefaultViewId)) {
    return roleDefaultViewId;
  }

  if (isDefined(lastVisitedViewId)) {
    return lastVisitedViewId;
  }

  if (isDefined(indexViewId)) {
    return indexViewId;
  }

  if (isDefined(firstAvailableViewId)) {
    return firstAvailableViewId;
  }

  return undefined;
};
