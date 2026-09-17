import { type EnsoLeadProfileSubject } from '@/enso/lead-lookup/types/EnsoLeadProfileSubject';
import { SidePanelPageComponentInstanceContext } from '@/side-panel/states/contexts/SidePanelPageComponentInstanceContext';
import { createAtomComponentState } from '@/ui/utilities/state/jotai/utils/createAtomComponentState';

export const ensoLeadProfileSubjectComponentState =
  createAtomComponentState<EnsoLeadProfileSubject | null>({
    key: 'enso/lead-profile-subject',
    defaultValue: null,
    componentInstanceContext: SidePanelPageComponentInstanceContext,
  });
