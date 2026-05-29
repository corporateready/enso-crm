import { Injectable } from '@nestjs/common';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

// personProjectConsent is a junction (person × project) carrying per-project
// marketing consent + audit. The composite name is "<person> · <project>".
// Same composite-from-relations pattern as personProjectAssignment and
// personRelationship — Twenty has no native lookup field, so we materialize
// the label on write.
type ConsentInput = {
  id?: string;
  personId?: string | null;
  projectId?: string | null;
  name?: string | null;
};

@Injectable()
export class PersonProjectConsentNameService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async computeName(
    authContext: WorkspaceAuthContext,
    record: ConsentInput,
  ): Promise<string | undefined> {
    const workspace = authContext.workspace;

    if (!workspace) {
      return undefined;
    }

    const workspaceId = workspace.id;

    // Reference data (person, project) is read with a system context so the
    // label can be computed for any caller, regardless of their object-level
    // permissions over Person or Project.
    const systemAuthContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        let personId = record.personId ?? undefined;
        let projectId = record.projectId ?? undefined;

        // On update the payload may omit fields that didn't change. Backfill
        // from the existing row so we can always rebuild the full label.
        if ((!personId || !projectId) && record.id) {
          const consentRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'personProjectConsent',
              { shouldBypassPermissionChecks: true },
            );

          const existing = await consentRepository.findOne({
            where: { id: record.id },
          });

          personId = personId ?? existing?.personId ?? undefined;
          projectId = projectId ?? existing?.projectId ?? undefined;
        }

        let personName = '';
        let projectName = '';

        if (personId) {
          const personRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'person',
              { shouldBypassPermissionChecks: true },
            );

          const person = await personRepository.findOne({
            where: { id: personId },
          });

          const firstName = person?.name?.firstName ?? '';
          const lastName = person?.name?.lastName ?? '';

          personName = `${firstName} ${lastName}`.trim();
        }

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

        const parts = [personName, projectName].filter(Boolean);

        return parts.length > 0 ? parts.join(' · ') : undefined;
      },
      systemAuthContext,
    );
  }
}
