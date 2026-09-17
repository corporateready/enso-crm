import { useEffect } from 'react';

import { contextStoreCurrentViewIdComponentState } from '@/context-store/states/contextStoreCurrentViewIdComponentState';
import { useEnsoPersonalColumnWidths } from '@/enso/column-widths/hooks/useEnsoPersonalColumnWidths';
import { applyEnsoPersonalColumnWidths } from '@/enso/column-widths/utils/applyEnsoPersonalColumnWidths';
import { currentRecordFieldsComponentState } from '@/object-record/record-field/states/currentRecordFieldsComponentState';
import { useAtomComponentState } from '@/ui/utilities/state/jotai/hooks/useAtomComponentState';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';

// Applies this person's own column widths on top of the ones the view was
// loaded with. It runs after the record fields are set rather than inside the
// mapping so it also catches the widths landing late, and it writes to the
// record fields the whole table already reads — the header, the rows, the group
// sections and the CSS variables all follow from there.
//
// Nothing writes these sizes back to the view: the resize handler persists them
// to this person's own row instead.
export const EnsoPersonalColumnWidthsEffect = () => {
  const contextStoreCurrentViewId = useAtomComponentStateValue(
    contextStoreCurrentViewIdComponentState,
  );

  const { personalColumnWidthByFieldMetadataId } = useEnsoPersonalColumnWidths(
    contextStoreCurrentViewId ?? undefined,
  );

  const [currentRecordFields, setCurrentRecordFields] = useAtomComponentState(
    currentRecordFieldsComponentState,
  );

  useEffect(() => {
    const nextRecordFields = applyEnsoPersonalColumnWidths({
      recordFields: currentRecordFields,
      personalColumnWidthByFieldMetadataId,
    });

    if (nextRecordFields !== currentRecordFields) {
      setCurrentRecordFields(nextRecordFields);
    }
  }, [
    currentRecordFields,
    personalColumnWidthByFieldMetadataId,
    setCurrentRecordFields,
  ]);

  return null;
};
