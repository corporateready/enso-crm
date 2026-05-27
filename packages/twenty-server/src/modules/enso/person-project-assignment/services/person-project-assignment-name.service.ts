import { Injectable } from '@nestjs/common';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';

// A personProjectAssignment is a junction record (person × project × manager).
// Junction records have no natural display label, so Twenty falls back to
// "Untitled". This service materializes the two meaningful relations
// (project + manager) into the scalar `name` field, the same way Person.name
// is a composite of firstName + lastName. Twenty has no native
// "composite-from-relations" field type, so we compute it here on write.
type AssignmentInput = {
  id?: string;
  projectId?: string | null;
  managerId?: string | null;
  name?: string | null;
};

@Injectable()
export class PersonProjectAssignmentNameService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async computeName(
    authContext: WorkspaceAuthContext,
    record: AssignmentInput,
  ): Promise<string | undefined> {
    const workspace = authContext.workspace;

    if (!workspace) {
      return undefined;
    }

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        let projectId = record.projectId ?? undefined;
        let managerId = record.managerId ?? undefined;

        // On update the FKs may be absent from the payload (e.g. only the
        // manager changed). Read the existing record to fill the gaps so we
        // can always build the full "project · manager" label.
        if ((!projectId || !managerId) && record.id) {
          const assignmentRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspace.id,
              'personProjectAssignment',
            );

          const existing = await assignmentRepository.findOne({
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
              workspace.id,
              'project',
            );

          const project = await projectRepository.findOne({
            where: { id: projectId },
          });

          projectName = project?.name ?? '';
        }

        if (managerId) {
          const workspaceMemberRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspace.id,
              'workspaceMember',
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
      authContext,
    );
  }
}
