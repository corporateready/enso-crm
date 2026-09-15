import { getViewId } from '@/context-store/utils/getViewId';

const URL_VIEW = 'url-view-id';
const INDEX_VIEW = 'index-view-id';
const LAST_VISITED_VIEW = 'last-visited-view-id';
const ROLE_DEFAULT_VIEW = 'role-default-view-id';
const FIRST_AVAILABLE_VIEW = 'first-available-view-id';

describe('getViewId', () => {
  it('should use the URL viewId when one is given', () => {
    expect(
      getViewId({
        viewIdFromQueryParams: URL_VIEW,
        indexViewId: INDEX_VIEW,
        lastVisitedViewId: LAST_VISITED_VIEW,
        roleDefaultViewId: ROLE_DEFAULT_VIEW,
        shouldSeedRoleDefaultView: true,
      }),
    ).toBe(URL_VIEW);
  });

  it('should use the role default over last-visited when it has not been seeded yet', () => {
    expect(
      getViewId({
        viewIdFromQueryParams: null,
        indexViewId: INDEX_VIEW,
        lastVisitedViewId: LAST_VISITED_VIEW,
        roleDefaultViewId: ROLE_DEFAULT_VIEW,
        shouldSeedRoleDefaultView: true,
      }),
    ).toBe(ROLE_DEFAULT_VIEW);
  });

  it('should use last-visited over the role default once it has been seeded', () => {
    expect(
      getViewId({
        viewIdFromQueryParams: null,
        indexViewId: INDEX_VIEW,
        lastVisitedViewId: LAST_VISITED_VIEW,
        roleDefaultViewId: ROLE_DEFAULT_VIEW,
        shouldSeedRoleDefaultView: false,
      }),
    ).toBe(LAST_VISITED_VIEW);
  });

  it('should use the role default over the index view when there is no last-visited', () => {
    expect(
      getViewId({
        viewIdFromQueryParams: null,
        indexViewId: INDEX_VIEW,
        roleDefaultViewId: ROLE_DEFAULT_VIEW,
        shouldSeedRoleDefaultView: false,
      }),
    ).toBe(ROLE_DEFAULT_VIEW);
  });

  it('should fall back to the index view when the role has no default', () => {
    expect(
      getViewId({
        viewIdFromQueryParams: null,
        indexViewId: INDEX_VIEW,
        lastVisitedViewId: undefined,
        roleDefaultViewId: undefined,
        shouldSeedRoleDefaultView: false,
      }),
    ).toBe(INDEX_VIEW);
  });

  // A role default that has been resolved away (deleted view, or one this
  // viewer cannot see) must not strand anyone on an undefined view.
  it('should ignore the seeding flag when the role default resolved to nothing', () => {
    expect(
      getViewId({
        viewIdFromQueryParams: null,
        indexViewId: INDEX_VIEW,
        lastVisitedViewId: LAST_VISITED_VIEW,
        roleDefaultViewId: undefined,
        shouldSeedRoleDefaultView: true,
      }),
    ).toBe(LAST_VISITED_VIEW);
  });

  it('should fall back to the first available view when there is no index view', () => {
    expect(
      getViewId({
        viewIdFromQueryParams: null,
        firstAvailableViewId: FIRST_AVAILABLE_VIEW,
      }),
    ).toBe(FIRST_AVAILABLE_VIEW);
  });

  it('should return undefined when there is no view to land on', () => {
    expect(getViewId({ viewIdFromQueryParams: null })).toBeUndefined();
  });
});
