import { getViewId } from '@/context-store/utils/getViewId';

const URL_VIEW = 'url-view-id';
const INDEX_VIEW = 'index-view-id';
const LAST_VISITED_VIEW = 'last-visited-view-id';
const ROLE_DEFAULT_VIEW = 'role-default-view-id';
const FIRST_AVAILABLE_VIEW = 'first-available-view-id';
const PERSONAL_DEFAULT_VIEW = 'personal-default-view-id';

describe('getViewId', () => {
  it('should use the URL viewId when one is given', () => {
    expect(
      getViewId({
        viewIdFromQueryParams: URL_VIEW,
        personalDefaultViewId: PERSONAL_DEFAULT_VIEW,
        indexViewId: INDEX_VIEW,
        lastVisitedViewId: LAST_VISITED_VIEW,
        roleDefaultViewId: ROLE_DEFAULT_VIEW,
      }),
    ).toBe(URL_VIEW);
  });

  it('should use the personal default over the role default', () => {
    expect(
      getViewId({
        viewIdFromQueryParams: null,
        personalDefaultViewId: PERSONAL_DEFAULT_VIEW,
        indexViewId: INDEX_VIEW,
        lastVisitedViewId: LAST_VISITED_VIEW,
        roleDefaultViewId: ROLE_DEFAULT_VIEW,
      }),
    ).toBe(PERSONAL_DEFAULT_VIEW);
  });

  it('should use the personal default over last-visited', () => {
    expect(
      getViewId({
        viewIdFromQueryParams: null,
        personalDefaultViewId: PERSONAL_DEFAULT_VIEW,
        lastVisitedViewId: LAST_VISITED_VIEW,
        indexViewId: INDEX_VIEW,
      }),
    ).toBe(PERSONAL_DEFAULT_VIEW);
  });

  // Managers land on their role's view every time until they pin their own.
  it('should use the role default over last-visited when there is no personal default', () => {
    expect(
      getViewId({
        viewIdFromQueryParams: null,
        indexViewId: INDEX_VIEW,
        lastVisitedViewId: LAST_VISITED_VIEW,
        roleDefaultViewId: ROLE_DEFAULT_VIEW,
      }),
    ).toBe(ROLE_DEFAULT_VIEW);
  });

  it('should use last-visited when the role has no default', () => {
    expect(
      getViewId({
        viewIdFromQueryParams: null,
        indexViewId: INDEX_VIEW,
        lastVisitedViewId: LAST_VISITED_VIEW,
        roleDefaultViewId: undefined,
      }),
    ).toBe(LAST_VISITED_VIEW);
  });

  it('should fall back to the index view when there is no default or last-visited', () => {
    expect(
      getViewId({
        viewIdFromQueryParams: null,
        indexViewId: INDEX_VIEW,
      }),
    ).toBe(INDEX_VIEW);
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
