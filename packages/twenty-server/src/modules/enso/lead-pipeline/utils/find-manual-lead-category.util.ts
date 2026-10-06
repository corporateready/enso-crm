import { isDefined } from 'twenty-shared/utils';

import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';

// The category of the manual lead source a hand-added activity names, so the
// deal and the person get REFERRAL / WALK_IN rather than a generic MANUAL.
// Null for every other kind of activity. Call inside a workspace context.
export const findManualLeadCategory = async (
  globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  workspaceId: string,
  activity: { kind?: string | null; manualLeadSourceId?: string | null },
): Promise<string | null> => {
  if (
    activity.kind !== 'MANUAL_ENTRY' ||
    !isDefined(activity.manualLeadSourceId)
  ) {
    return null;
  }

  const repository = await globalWorkspaceOrmManager.getRepository<any>(
    workspaceId,
    'manualLeadSource',
    { shouldBypassPermissionChecks: true },
  );

  const source = await repository.findOne({
    where: { id: activity.manualLeadSourceId },
  });

  return source?.category ?? null;
};
