export type PbxGroupReceptionState = {
  groupId: string;
  memberLogins: string[];
  // Members currently receiving this group's calls. Only needs to be read for
  // groups with more than one member.
  receivingLogins: string[];
};

export type DepartmentReceptionPlan = {
  // Groups whose reception must be switched to the requested state.
  toChange: string[];
  // Already in the requested state; nothing to send.
  unchanged: string[];
  // One-member groups. These sit behind a manager's personal line, not a
  // department, so "no new leads" must not silence them.
  personal: string[];
  // Turning the manager off here would leave nobody receiving the
  // department's calls, so they stay on.
  keptOnAsLastReceiver: string[];
};

// "Not accepting leads" means no cold department calls. It never means "my
// own clients cannot reach me" (transfer-to-responsible rings the manager
// directly, not through a group), and it never means "this department's
// numbers ring nobody".
export const planDepartmentReception = ({
  login,
  isReceiving,
  groups,
}: {
  login: string;
  isReceiving: boolean;
  groups: PbxGroupReceptionState[];
}): DepartmentReceptionPlan => {
  const plan: DepartmentReceptionPlan = {
    toChange: [],
    unchanged: [],
    personal: [],
    keptOnAsLastReceiver: [],
  };

  for (const group of groups) {
    if (!group.memberLogins.includes(login)) {
      continue;
    }

    if (group.memberLogins.length <= 1) {
      plan.personal.push(group.groupId);
      continue;
    }

    const isCurrentlyReceiving = group.receivingLogins.includes(login);

    if (isCurrentlyReceiving === isReceiving) {
      plan.unchanged.push(group.groupId);
      continue;
    }

    const otherReceivers = group.receivingLogins.filter(
      (receivingLogin) => receivingLogin !== login,
    );

    if (!isReceiving && otherReceivers.length === 0) {
      plan.keptOnAsLastReceiver.push(group.groupId);
      continue;
    }

    plan.toChange.push(group.groupId);
  }

  return plan;
};
