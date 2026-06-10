import { getObjectPermissionsForObject } from '@/object-metadata/utils/getObjectPermissionsForObject';
import { isRecordFieldReadOnly } from '@/object-record/read-only/utils/isRecordFieldReadOnly';
import { FieldContext } from '@/object-record/record-field/ui/contexts/FieldContext';
import { useRecordIndexContextOrThrow } from '@/object-record/record-index/contexts/RecordIndexContext';
import { shouldCompactRecordIndexLabelIdentifierComponentState } from '@/object-record/record-index/states/shouldCompactRecordIndexLabelIdentifierComponentState';
import { RecordTableCellContext } from '@/object-record/record-table/contexts/RecordTableCellContext';
import { useRecordTableContextOrThrow } from '@/object-record/record-table/contexts/RecordTableContext';
import { useRecordTableRowContextOrThrow } from '@/object-record/record-table/contexts/RecordTableRowContext';
import { RecordTableUpdateContext } from '@/object-record/record-table/contexts/RecordTableUpdateContext';
import { isRecordTableCellsNonEditableComponentState } from '@/object-record/record-table/states/isRecordTableCellsNonEditableComponentState';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';
import { useContext, useRef, type MouseEvent, type ReactNode } from 'react';
import { AppPath } from 'twenty-shared/types';
import { useNavigateApp } from '~/hooks/useNavigateApp';

// A second chip click within this window counts as a double-click.
const DOUBLE_CLICK_THRESHOLD_IN_MS = 300;

type RecordTableCellFieldContextLabelIdentifierProps = {
  children: ReactNode;
};

export const RecordTableCellFieldContextLabelIdentifier = ({
  children,
}: RecordTableCellFieldContextLabelIdentifierProps) => {
  const {
    objectPermissionsByObjectMetadataId,
    fieldDefinitionByFieldMetadataItemId,
  } = useRecordIndexContextOrThrow();
  const { recordId, isRecordReadOnly, rowIndex } =
    useRecordTableRowContextOrThrow();

  const isRecordTableCellsNonEditable = useAtomComponentStateValue(
    isRecordTableCellsNonEditableComponentState,
  );

  const { recordField } = useContext(RecordTableCellContext);
  const { objectMetadataItem, onRecordIdentifierClick, triggerEvent } =
    useRecordTableContextOrThrow();

  const objectPermissions = getObjectPermissionsForObject(
    objectPermissionsByObjectMetadataId,
    objectMetadataItem.id,
  );

  const shouldCompactRecordIndexLabelIdentifier = useAtomComponentStateValue(
    shouldCompactRecordIndexLabelIdentifierComponentState,
  );

  const hasObjectReadPermissions = objectPermissions.canReadObjectRecords;

  const updateRecord = useContext(RecordTableUpdateContext);

  const fieldDefinition =
    fieldDefinitionByFieldMetadataItemId[recordField.fieldMetadataItemId];

  const navigate = useNavigateApp();
  const lastChipClickTimestampRef = useRef<number | null>(null);

  const openRecordInFullPage = () => {
    navigate(AppPath.RecordShowPage, {
      objectNameSingular: objectMetadataItem.nameSingular,
      objectRecordId: recordId,
    });
  };

  const handleChipClick = () => {
    onRecordIdentifierClick?.(rowIndex, recordId);
  };

  // The name lives in the frozen first column (outside the row's own handler)
  // and is a real <a> link. Handle the open-in-full-page gesture on click
  // CAPTURE, above the anchor: preventDefault cancels the browser's Option+click
  // "download link" default, and stopPropagation suppresses the chip's own click
  // so it doesn't also open the side panel. A plain click falls through.
  const handleLabelClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    const now = Date.now();
    const lastTimestamp = lastChipClickTimestampRef.current;
    const isDoubleClick =
      lastTimestamp !== null &&
      now - lastTimestamp < DOUBLE_CLICK_THRESHOLD_IN_MS;

    if (event.altKey || isDoubleClick) {
      event.preventDefault();
      event.stopPropagation();
      lastChipClickTimestampRef.current = null;
      openRecordInFullPage();
      return;
    }

    lastChipClickTimestampRef.current = now;
  };

  return (
    <FieldContext.Provider
      value={{
        recordId,
        fieldDefinition,
        useUpdateRecord: updateRecord ? () => [updateRecord, {}] : undefined,
        isLabelIdentifier: true,
        isLabelIdentifierCompact: shouldCompactRecordIndexLabelIdentifier,
        displayedMaxRows: 1,
        isRecordFieldReadOnly:
          isRecordTableCellsNonEditable ||
          isRecordFieldReadOnly({
            isRecordReadOnly: isRecordReadOnly ?? false,
            isSystemObject: objectMetadataItem.isSystem,
            objectPermissions,
            fieldMetadataItem: {
              id: recordField.fieldMetadataItemId,
              isUIReadOnly: fieldDefinition.metadata.isUIReadOnly ?? false,
              isCustom: fieldDefinition.metadata.isCustom ?? false,
            },
            fieldDefinition,
            objectPermissionsByObjectMetadataId,
          }),
        maxWidth: recordField.size,
        onRecordChipClick: handleChipClick,
        isForbidden: !hasObjectReadPermissions,
        triggerEvent,
      }}
    >
      <div style={{ display: 'contents' }} onClickCapture={handleLabelClickCapture}>
        {children}
      </div>
    </FieldContext.Provider>
  );
};
