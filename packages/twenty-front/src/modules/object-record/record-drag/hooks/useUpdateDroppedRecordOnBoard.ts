import { useStore } from 'jotai';

import { RecordBoardContext } from '@/object-record/record-board/contexts/RecordBoardContext';
import { extractRecordPositions } from '@/object-record/record-drag/utils/extractRecordPositions';
import { recordGroupDefinitionsComponentSelector } from '@/object-record/record-group/states/selectors/recordGroupDefinitionsComponentSelector';
import { type RecordGroupDefinition } from '@/object-record/record-group/types/RecordGroupDefinition';
import { recordIndexRecordIdsByGroupComponentFamilyState } from '@/object-record/record-index/states/recordIndexRecordIdsByGroupComponentFamilyState';
import { useUpsertRecordsInStore } from '@/object-record/record-store/hooks/useUpsertRecordsInStore';
import { recordStoreFamilyState } from '@/object-record/record-store/states/recordStoreFamilyState';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { type ObjectRecord } from '@/object-record/types/ObjectRecord';
import { useAtomComponentFamilyStateCallbackState } from '@/ui/utilities/state/jotai/hooks/useAtomComponentFamilyStateCallbackState';
import { useAtomComponentSelectorValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentSelectorValue';
import { useCallback, useContext } from 'react';
import { findByProperty, isDefined } from 'twenty-shared/utils';
import { sortByProperty } from '~/utils/array/sortByProperty';

export const useUpdateDroppedRecordOnBoard = () => {
  const store = useStore();
  const { updateOneRecord, selectFieldMetadataItem } =
    useContext(RecordBoardContext);

  const recordIndexRecordIdsByGroupCallbackFamilyState =
    useAtomComponentFamilyStateCallbackState(
      recordIndexRecordIdsByGroupComponentFamilyState,
    );

  const recordGroupDefinitions = useAtomComponentSelectorValue(
    recordGroupDefinitionsComponentSelector,
  );

  const { upsertRecordsInStore } = useUpsertRecordsInStore();
  const { enqueueErrorSnackBar } = useSnackBar();

  const updateDroppedRecordOnBoard = useCallback(
    (
      {
        recordId,
        position: newPosition,
      }: {
        recordId: string;
        position?: number;
      },
      targetRecordGroupValue: RecordGroupDefinition['value'],
    ) => {
      const initialRecord = store.get(
        recordStoreFamilyState.atomFamily(recordId),
      ) as Record<string, unknown> | null | undefined;

      if (!isDefined(newPosition)) {
        return;
      }

      if (!isDefined(initialRecord)) {
        return;
      }

      let currentRecordIdsInInitialRecordGroup: string[] = [];

      const initialRecordGroup = recordGroupDefinitions.find(
        (recordGroupDefinition) => {
          const recordIdsInGroup = store.get(
            recordIndexRecordIdsByGroupCallbackFamilyState(
              recordGroupDefinition.id,
            ),
          );

          const recordIsInGroup = recordIdsInGroup.includes(recordId);

          if (recordIsInGroup) {
            currentRecordIdsInInitialRecordGroup = recordIdsInGroup;
          }

          return recordIsInGroup;
        },
      );

      if (!isDefined(initialRecordGroup)) {
        return;
      }

      const initialRecordGroupId = initialRecordGroup.id;

      const targetRecordGroup = recordGroupDefinitions.find(
        findByProperty('value', targetRecordGroupValue),
      );

      if (!isDefined(targetRecordGroup)) {
        return;
      }

      const targetRecordGroupId = targetRecordGroup.id;

      const movingInsideSameRecordGroup =
        initialRecordGroupId === targetRecordGroupId;

      const isSamePosition = initialRecord.position === newPosition;

      if (movingInsideSameRecordGroup && isSamePosition) {
        return;
      }

      const indexOfDroppedRecordInInitialRecordGroup =
        currentRecordIdsInInitialRecordGroup.findIndex((id) => id === recordId);

      let currentRecordIdsInTargetRecordGroup = store.get(
        recordIndexRecordIdsByGroupCallbackFamilyState(targetRecordGroupId),
      ) as string[];

      const previousTargetGroupRecordIds = currentRecordIdsInTargetRecordGroup;
      const previousInitialGroupRecordIds =
        currentRecordIdsInInitialRecordGroup;

      if (indexOfDroppedRecordInInitialRecordGroup === -1) {
        throw new Error(
          `Cannot find record id in initial record group ids on drop, this should not happen, recordId: ${recordId}, initialRecordGroupId: ${initialRecordGroupId}`,
        );
      }

      const newInitialGroupRecordIds =
        currentRecordIdsInInitialRecordGroup.toSpliced(
          indexOfDroppedRecordInInitialRecordGroup,
          1,
        );

      if (movingInsideSameRecordGroup) {
        currentRecordIdsInTargetRecordGroup = newInitialGroupRecordIds;
      } else {
        store.set(
          recordIndexRecordIdsByGroupCallbackFamilyState(initialRecordGroupId),
          newInitialGroupRecordIds,
        );
      }

      const targetGroupRecordsWithIds = extractRecordPositions(
        currentRecordIdsInTargetRecordGroup,
        store,
      );

      const newTargetRecordGroupWithIds = [
        ...targetGroupRecordsWithIds,
        {
          id: recordId,
          position: newPosition,
        },
      ];

      newTargetRecordGroupWithIds.sort(sortByProperty('position', 'asc'));

      store.set(
        recordIndexRecordIdsByGroupCallbackFamilyState(targetRecordGroupId),
        newTargetRecordGroupWithIds.map((record) => record.id),
      );

      upsertRecordsInStore({
        partialRecords: [
          {
            ...initialRecord,
            id: recordId,
            __typename:
              (initialRecord as { __typename?: string })?.__typename ??
              'Record',
            [selectFieldMetadataItem.name]: targetRecordGroupValue,
            position: newPosition,
          } as ObjectRecord,
        ],
      });

      // The card moves straight away; if the server refuses the move (a stage
      // gate, a validation rule), put it back where it was and say why.
      updateOneRecord({
        idToUpdate: recordId,
        updateOneRecordInput: {
          [selectFieldMetadataItem.name]: targetRecordGroupValue,
          position: newPosition,
        },
      }).catch((error: Error) => {
        store.set(
          recordIndexRecordIdsByGroupCallbackFamilyState(initialRecordGroupId),
          previousInitialGroupRecordIds,
        );

        if (!movingInsideSameRecordGroup) {
          store.set(
            recordIndexRecordIdsByGroupCallbackFamilyState(targetRecordGroupId),
            previousTargetGroupRecordIds,
          );
        }

        upsertRecordsInStore({
          partialRecords: [initialRecord as ObjectRecord],
        });
        enqueueErrorSnackBar({ apolloError: error });
      });
    },
    [
      recordGroupDefinitions,
      recordIndexRecordIdsByGroupCallbackFamilyState,
      selectFieldMetadataItem,
      store,
      upsertRecordsInStore,
      updateOneRecord,
      enqueueErrorSnackBar,
    ],
  );

  return {
    updateDroppedRecordOnBoard,
  };
};
