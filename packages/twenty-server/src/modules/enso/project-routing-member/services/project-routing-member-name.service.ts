import { Injectable } from '@nestjs/common';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

// projectRoutingMember is a junction (project × workspaceMember) defining the
// routing pool: which managers receive round-robin leads for which project.
// Junction rows have no natural label, so we materialize "<project> · <manager>"
// into the scalar `name` field (same pattern as personProjectAssignment).
type RoutingMemberInput = {
  id?: string;
  projectId?: string | null;
  managerId?: string | null;
  name?: string | null;
};

@Injectable()
export class ProjectRoutingMemberNameService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async computeName(
    authContext: WorkspaceAuthContext,
    record: RoutingMemberInput,
  ): Promise<string | undefined> {
    const workspace = authContext.workspace;

    if (!workspace) {
      return undefined;
    }

    const workspaceId = workspace.id;

    // Reference data (project, workspaceMember) read with a system context that
    // bypasses permission checks — computing the label must never depend on the
    // caller's row/object permissions.
    const systemAuthContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        let projectId = record.projectId ?? undefined;
        let managerId = record.managerId ?? undefined;

        // On update the FKs may be absent from the payload — backfill from the
        // existing row so we can always build the full label.
        if ((!projectId || !managerId) && record.id) {
          const routingMemberRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'projectRoutingMember',
              { shouldBypassPermissionChecks: true },
            );

          const existing = await routingMemberRepository.findOne({
            where: { id: record.id },
          });

          projectId = projectId ?? existing?.projectId ?? undefined;
          managerId = managerId ?? existing?.managerId ?? undefined;
        }

        let projectName = '';
        let managerName = '';

        if (projectId) {
          const projectRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'project',
              { shouldBypassPermissionChecks: true },
            );

          const project = await projectRepository.findOne({
            where: { id: projectId },
          });

          projectName = project?.name ?? '';
        }

        if (managerId) {
          const workspaceMemberRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'workspaceMember',
              { shouldBypassPermissionChecks: true },
            );

          const manager = await workspaceMemberRepository.findOne({
            where: { id: managerId },
          });

          const firstName = manager?.name?.firstName ?? '';
          const lastName = manager?.name?.lastName ?? '';

          managerName = `${firstName} ${lastName}`.trim();
        }

        const parts = [projectName, managerName].filter(Boolean);

        return parts.length > 0 ? parts.join(' · ') : undefined;
      },
      systemAuthContext,
    );
  }
}
