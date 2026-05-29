import { Injectable } from '@nestjs/common';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { OPPORTUNITY_SOURCE_LABEL } from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';

// Opportunity.name is a plain scalar TEXT field, but for inbound-created deals
// we want a meaningful label rather than "Untitled". Mirrors the legacy Attio
// convention: "<source> | <phone or name> | <project>"
// e.g. "Form | +37379628432 | ARTIMA Business & Lifestyle".
type OpportunityNameInput = {
  personId?: string | null;
  projectId?: string | null;
  source?: string | null;
};

@Injectable()
export class OpportunityNameService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async computeName(
    authContext: WorkspaceAuthContext,
    input: OpportunityNameInput,
  ): Promise<string | undefined> {
    const workspaceId = authContext.workspace?.id;

    if (!workspaceId) {
      return undefined;
    }

    // Reference data (person, project) is read with a system context that
    // bypasses permission checks — same rationale as the junction name services.
    const systemAuthContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const sourceLabel =
          OPPORTUNITY_SOURCE_LABEL[input.source ?? 'OTHER'] ?? 'Lead';

        let who = '';

        if (input.personId) {
          const personRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'person',
              { shouldBypassPermissionChecks: true },
            );

          const person = await personRepository.findOne({
            where: { id: input.personId },
          });

          who =
            person?.phones?.primaryPhoneNumber ??
            `${person?.name?.firstName ?? ''} ${person?.name?.lastName ?? ''}`.trim();
        }

        let projectName = '';

        if (input.projectId) {
          const projectRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'project',
              { shouldBypassPermissionChecks: true },
            );

          const project = await projectRepository.findOne({
            where: { id: input.projectId },
          });

          projectName = project?.name ?? '';
        }

        const parts = [sourceLabel, who, projectName].filter(Boolean);

        return parts.length > 0 ? parts.join(' | ') : undefined;
      },
      systemAuthContext,
    );
  }
}
