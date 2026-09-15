import { createAtomState } from '@/ui/utilities/state/jotai/utils/createAtomState';

// Which version of their role's default views this person has already been
// landed on, per object.
//
// A role default is a starting point, not a cage: once someone has been shown
// it they are free to move, and where they were last wins from then on. But a
// default that only ever applied to people who had NEVER opened the object
// would be invisible to every existing member, so rewriting a role's defaults
// bumps the version and re-seeds each object once more.
export const appliedRoleDefaultViewVersionPerObjectMetadataItemState =
  createAtomState<Record<string, string> | null>({
    key: 'appliedRoleDefaultViewVersionPerObjectMetadataItemState',
    defaultValue: null,
    useLocalStorage: true,
  });
