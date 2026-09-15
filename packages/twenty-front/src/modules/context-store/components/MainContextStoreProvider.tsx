import { MainContextStoreProviderEffect } from '@/context-store/components/MainContextStoreProviderEffect';
import { getViewId } from '@/context-store/utils/getViewId';
import { useEnsoViewerScope } from '@/enso/viewer-scope/hooks/useEnsoViewerScope';
import { appliedRoleDefaultViewVersionPerObjectMetadataItemState } from '@/navigation/states/appliedRoleDefaultViewVersionPerObjectMetadataItemState';
import { metadataStoreState } from '@/metadata-store/states/metadataStoreState';
import { useIsSettingsPage } from '@/navigation/hooks/useIsSettingsPage';
import { useLastVisitedView } from '@/navigation/hooks/useLastVisitedView';
import { objectMetadataItemsSelector } from '@/object-metadata/states/objectMetadataItemsSelector';
import { useAtomFamilyStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomFamilyStateValue';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { viewsSelector } from '@/views/states/selectors/viewsSelector';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { AppPath } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { ViewKey, ViewType } from '~/generated-metadata/graphql';
import { isMatchingLocation } from '~/utils/isMatchingLocation';

export const MainContextStoreProvider = () => {
  const location = useLocation();
  const isRecordIndexPage = isMatchingLocation(
    location,
    AppPath.RecordIndexPage,
  );
  const isRecordShowPage = isMatchingLocation(location, AppPath.RecordShowPage);
  const isStandalonePage = isMatchingLocation(location, AppPath.PageLayoutPage);
  const isSettingsPage = useIsSettingsPage();

  const objectNamePlural = useParams().objectNamePlural ?? '';
  const objectNameSingular = useParams().objectNameSingular ?? '';

  const [searchParams] = useSearchParams();
  const viewIdQueryParamRaw = searchParams.get('viewId');

  const objectMetadataItems = useAtomStateValue(objectMetadataItemsSelector);
  const metadataStore = useAtomFamilyStateValue(metadataStoreState, 'views');
  const views = useAtomStateValue(viewsSelector);

  const objectMetadataItem = objectMetadataItems.find(
    (objectMetadataItem) =>
      objectMetadataItem.namePlural === objectNamePlural ||
      objectMetadataItem.nameSingular === objectNameSingular,
  );

  const { getLastVisitedViewIdFromObjectNamePlural } = useLastVisitedView();
  const {
    roleDefaultViewIdByObjectMetadataId,
    personalDefaultViewIdByObjectMetadataId,
    roleDefaultViewsVersion,
    isEnsoViewerScopeLoading,
  } = useEnsoViewerScope();

  const appliedRoleDefaultViewVersionPerObjectMetadataItem = useAtomStateValue(
    appliedRoleDefaultViewVersionPerObjectMetadataItemState,
  );

  const viewIdQueryParamView = views.find(
    (view) => view.id === viewIdQueryParamRaw,
  );

  const viewIdQueryParam =
    isDefined(viewIdQueryParamView) &&
    viewIdQueryParamView.type !== ViewType.FIELDS_WIDGET
      ? viewIdQueryParamRaw
      : null;

  const lastVisitedViewIdRaw = getLastVisitedViewIdFromObjectNamePlural(
    objectMetadataItem?.namePlural ?? '',
  );

  const lastVisitedView = views.find(
    (view) => view.id === lastVisitedViewIdRaw,
  );

  const lastVisitedViewId =
    isDefined(lastVisitedView) &&
    lastVisitedView.type !== ViewType.FIELDS_WIDGET
      ? lastVisitedViewIdRaw
      : undefined;

  const indexViewId = views.find(
    (view) =>
      view.objectMetadataId === objectMetadataItem?.id &&
      view.key === ViewKey.INDEX,
  )?.id;

  const firstAvailableViewId = views.find(
    (view) =>
      view.objectMetadataId === objectMetadataItem?.id &&
      view.type !== ViewType.FIELDS_WIDGET,
  )?.id;

  // A role default pointing at a view that no longer exists, or that this
  // viewer cannot see, must not strand them — hence the lookup against `views`.
  const roleDefaultViewIdRaw = isDefined(objectMetadataItem)
    ? roleDefaultViewIdByObjectMetadataId[objectMetadataItem.id]
    : undefined;

  const roleDefaultViewId = views.find(
    (view) =>
      view.id === roleDefaultViewIdRaw && view.type !== ViewType.FIELDS_WIDGET,
  )?.id;

  // Same guard as the role default: a personal default pointing at a view that
  // has since been deleted must not strand the person on nothing.
  const personalDefaultViewIdRaw = isDefined(objectMetadataItem)
    ? personalDefaultViewIdByObjectMetadataId[objectMetadataItem.id]
    : undefined;

  const personalDefaultViewId = views.find(
    (view) =>
      view.id === personalDefaultViewIdRaw &&
      view.type !== ViewType.FIELDS_WIDGET,
  )?.id;

  // Seed once per object per version of the role's configuration.
  const shouldSeedRoleDefaultView =
    isDefined(objectMetadataItem) &&
    isDefined(roleDefaultViewId) &&
    isDefined(roleDefaultViewsVersion) &&
    appliedRoleDefaultViewVersionPerObjectMetadataItem?.[
      objectMetadataItem.id
    ] !== roleDefaultViewsVersion;

  const viewId = getViewId({
    viewIdFromQueryParams: viewIdQueryParam,
    personalDefaultViewId,
    indexViewId,
    lastVisitedViewId,
    firstAvailableViewId,
    roleDefaultViewId,
    shouldSeedRoleDefaultView,
  });

  // Only record the seeding once it is what actually happened — an explicit
  // ?viewId in the URL must not burn this person's one application of it.
  const roleDefaultViewVersionToMark =
    shouldSeedRoleDefaultView && viewId === roleDefaultViewId
      ? roleDefaultViewsVersion
      : undefined;

  // Waiting on the viewer scope is load-bearing, not tidiness: answering while
  // it is still in flight resolves to the INDEX view, and landing on a view
  // writes it as last-visited, so an early answer is a permanent one.
  const shouldComputeContextStore =
    (isRecordIndexPage ||
      isRecordShowPage ||
      isStandalonePage ||
      isSettingsPage) &&
    metadataStore.status === 'up-to-date' &&
    !isEnsoViewerScopeLoading;

  if (!shouldComputeContextStore) {
    return null;
  }

  return (
    <MainContextStoreProviderEffect
      viewId={viewId}
      roleDefaultViewVersionToMark={roleDefaultViewVersionToMark}
      objectMetadataItem={objectMetadataItem}
      isRecordIndexPage={isRecordIndexPage}
      isRecordShowPage={isRecordShowPage}
      isStandalonePage={isStandalonePage}
      isSettingsPage={isSettingsPage}
    />
  );
};
