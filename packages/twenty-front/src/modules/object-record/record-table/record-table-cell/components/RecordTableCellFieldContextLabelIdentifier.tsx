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
import { useContext, useEffect, useRef, type ReactNode } from 'react';
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
  const objectNameSingular = objectMetadataItem.nameSingular;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const lastChipClickTimestampRef = useRef<number | null>(null);

  const handleChipClick = () => {
    onRecordIdentifierClick?.(rowIndex, recordId);
  };

  // The name lives in the frozen first column (outside the row's own handler)
  // and is a real <a> link, so Option+click triggers the browser's "download
  // link" default. Use a NATIVE capture-phase listener (not React's synthetic
  // onClickCapture, which can miss on a display:contents wrapper): it always
  // fires before the anchor's default, so preventDefault reliably cancels the
  // download. Option+click and double-click open the full page; stopPropagation
  // suppresses the chip's own click; a plain click falls through.
  useEffect(() => {
    const wrapperElement = wrapperRef.current;

    if (!wrapperElement) {
      return;
    }

    const handleClickCapture = (event: globalThis.MouseEvent) => {
      const now = Date.now();
      const lastTimestamp = lastChipClickTimestampRef.current;
      const isDoubleClick =
        lastTimestamp !== null &&
        now - lastTimestamp < DOUBLE_CLICK_THRESHOLD_IN_MS;

      if (event.altKey || isDoubleClick) {
        event.preventDefault();
        event.stopPropagation();
        lastChipClickTimestampRef.current = null;
        navigate(AppPath.RecordShowPage, {
          objectNameSingular,
          objectRecordId: recordId,
        });
        return;
      }

      lastChipClickTimestampRef.current = now;
    };

    wrapperElement.addEventListener('click', handleClickCapture, true);

    return () => {
      wrapperElement.removeEventListener('click', handleClickCapture, true);
    };
  }, [navigate, objectNameSingular, recordId]);

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
      <div ref={wrapperRef} style={{ display: 'contents' }}>
        {children}
      </div>
    </FieldContext.Provider>
  );
};
