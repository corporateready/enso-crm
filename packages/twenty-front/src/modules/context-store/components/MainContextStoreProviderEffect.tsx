import { MAIN_CONTEXT_STORE_INSTANCE_ID } from '@/context-store/constants/MainContextStoreInstanceId';
import { contextStoreCurrentObjectMetadataItemIdComponentState } from '@/context-store/states/contextStoreCurrentObjectMetadataItemIdComponentState';
import { contextStoreCurrentPageTypeComponentState } from '@/context-store/states/contextStoreCurrentPageTypeComponentState';
import { contextStoreCurrentViewIdComponentState } from '@/context-store/states/contextStoreCurrentViewIdComponentState';
import { contextStoreCurrentViewTypeComponentState } from '@/context-store/states/contextStoreCurrentViewTypeComponentState';
import { getPageType } from '@/context-store/utils/getPageType';
import { getViewType } from '@/context-store/utils/getViewType';
import { useMarkRoleDefaultViewApplied } from '@/navigation/hooks/useMarkRoleDefaultViewApplied';
import { useSetLastVisitedObjectMetadataId } from '@/navigation/hooks/useSetLastVisitedObjectMetadataId';
import { useSetLastVisitedViewForObjectMetadataNamePlural } from '@/navigation/hooks/useSetLastVisitedViewForObjectMetadataNamePlural';
import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';
import { useAtomComponentState } from '@/ui/utilities/state/jotai/hooks/useAtomComponentState';
import { useAtomFamilySelectorValue } from '@/ui/utilities/state/jotai/hooks/useAtomFamilySelectorValue';
import { viewFromViewIdFamilySelector } from '@/views/states/selectors/viewFromViewIdFamilySelector';
import { useEffect } from 'react';
import { isDefined } from 'twenty-shared/utils';

type MainContextStoreProviderEffectProps = {
  viewId?: string;
  // Set only when `viewId` above IS this person's role default being applied
  // for the first time at this version, so it is recorded as spent.
  roleDefaultViewVersionToMark?: string;
  objectMetadataItem?: EnrichedObjectMetadataItem;
  isRecordIndexPage: boolean;
  isRecordShowPage: boolean;
  isStandalonePage: boolean;
  isSettingsPage: boolean;
};

export const MainContextStoreProviderEffect = ({
  viewId,
  roleDefaultViewVersionToMark,
  objectMetadataItem,
  isRecordIndexPage,
  isRecordShowPage,
  isStandalonePage,
  isSettingsPage,
}: MainContextStoreProviderEffectProps) => {
  const { setLastVisitedViewForObjectMetadataNamePlural } =
    useSetLastVisitedViewForObjectMetadataNamePlural();

  const { setLastVisitedObjectMetadataId } =
    useSetLastVisitedObjectMetadataId();

  const { markRoleDefaultViewApplied } = useMarkRoleDefaultViewApplied();

  const [contextStoreCurrentViewId, setContextStoreCurrentViewId] =
    useAtomComponentState(
      contextStoreCurrentViewIdComponentState,
      MAIN_CONTEXT_STORE_INSTANCE_ID,
    );

  const [contextStoreCurrentViewType, setContextStoreCurrentViewType] =
    useAtomComponentState(
      contextStoreCurrentViewTypeComponentState,
      MAIN_CONTEXT_STORE_INSTANCE_ID,
    );

  const [contextStoreCurrentPageType, setContextStoreCurrentPageType] =
    useAtomComponentState(
      contextStoreCurrentPageTypeComponentState,
      MAIN_CONTEXT_STORE_INSTANCE_ID,
    );

  const [
    contextStoreCurrentObjectMetadataItemId,
    setContextStoreCurrentObjectMetadataItemId,
  ] = useAtomComponentState(
    contextStoreCurrentObjectMetadataItemIdComponentState,
    MAIN_CONTEXT_STORE_INSTANCE_ID,
  );

  const view = useAtomFamilySelectorValue(viewFromViewIdFamilySelector, {
    viewId: viewId ?? '',
  });

  useEffect(() => {
    if (contextStoreCurrentObjectMetadataItemId !== objectMetadataItem?.id) {
      setContextStoreCurrentObjectMetadataItemId(objectMetadataItem?.id);
    }

    if (!objectMetadataItem) {
      return;
    }

    setLastVisitedViewForObjectMetadataNamePlural({
      objectNamePlural: objectMetadataItem.namePlural,
      viewId: viewId ?? '',
    });

    setLastVisitedObjectMetadataId({
      objectMetadataItemId: objectMetadataItem.id,
    });

    // After the last-visited write above, never before: that write is what
    // makes this landing stick, and marking the seeding spent immediately stops
    // the role default out-ranking it on the next render.
    if (isDefined(roleDefaultViewVersionToMark)) {
      markRoleDefaultViewApplied({
        objectMetadataItemId: objectMetadataItem.id,
        version: roleDefaultViewVersionToMark,
      });
    }
  }, [
    contextStoreCurrentObjectMetadataItemId,
    markRoleDefaultViewApplied,
    objectMetadataItem,
    roleDefaultViewVersionToMark,
    setContextStoreCurrentObjectMetadataItemId,
    setLastVisitedObjectMetadataId,
    setLastVisitedViewForObjectMetadataNamePlural,
    viewId,
  ]);

  useEffect(() => {
    if (isSettingsPage) {
      setContextStoreCurrentViewId(undefined);
      return;
    }

    if (contextStoreCurrentViewId !== viewId) {
      setContextStoreCurrentViewId(viewId);
    }
  }, [
    contextStoreCurrentViewId,
    isSettingsPage,
    setContextStoreCurrentViewId,
    viewId,
  ]);

  useEffect(() => {
    const viewType = getViewType({
      isRecordIndexPage,
      view,
    });

    if (contextStoreCurrentViewType !== viewType) {
      setContextStoreCurrentViewType(viewType);
    }
  }, [
    contextStoreCurrentViewType,
    setContextStoreCurrentViewType,
    view,
    isRecordIndexPage,
  ]);

  useEffect(() => {
    const pageType = getPageType({
      isSettingsPage,
      isRecordShowPage,
      isRecordIndexPage,
      isStandalonePage,
    });

    if (contextStoreCurrentPageType !== pageType) {
      setContextStoreCurrentPageType(pageType);
    }
  }, [
    contextStoreCurrentPageType,
    setContextStoreCurrentPageType,
    isSettingsPage,
    isRecordShowPage,
    isRecordIndexPage,
    isStandalonePage,
  ]);

  return null;
};
