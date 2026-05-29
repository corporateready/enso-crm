import { useLingui } from '@lingui/react/macro';
import { IconCircleDot } from 'twenty-ui/display';

import { currentWorkspaceMemberState } from '@/auth/states/currentWorkspaceMemberState';
import { useFindOneRecord } from '@/object-record/hooks/useFindOneRecord';
import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { NavigationDrawerItem } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerItem';
import { NavigationDrawerSection } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerSection';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { isDefined } from 'twenty-shared/utils';

// Self-service lead-routing presence, like a Slack online/away switch. Flips the
// current workspace member's `isAvailableForRouting` so managers opt themselves
// into / out of round-robin lead routing. Read/written via the generic record
// hooks (the field is custom and not on the static currentWorkspaceMember type).
export const RoutingPresenceSection = () => {
  const { t } = useLingui();
  const currentWorkspaceMember = useAtomStateValue(currentWorkspaceMemberState);
  const workspaceMemberId = currentWorkspaceMember?.id;

  const { record } = useFindOneRecord({
    objectNameSingular: 'workspaceMember',
    objectRecordId: workspaceMemberId,
    skip: !isDefined(workspaceMemberId),
  });

  const { updateOneRecord } = useUpdateOneRecord();

  if (!isDefined(workspaceMemberId) || !isDefined(record)) {
    return null;
  }

  const isAvailable = record.isAvailableForRouting === true;

  const handleToggle = async () => {
    await updateOneRecord({
      objectNameSingular: 'workspaceMember',
      idToUpdate: workspaceMemberId,
      updateOneRecordInput: { isAvailableForRouting: !isAvailable },
      optimisticRecord: { isAvailableForRouting: !isAvailable },
    });
  };

  return (
    <NavigationDrawerSection>
      <NavigationDrawerItem
        label={isAvailable ? t`Accepting leads` : t`Not accepting leads`}
        Icon={IconCircleDot}
        // Colored status dot: green = accepting, yellow = paused.
        iconColor={isAvailable ? 'green' : 'yellow'}
        onClick={handleToggle}
        active={isAvailable}
      />
    </NavigationDrawerSection>
  );
};
