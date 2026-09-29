import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import {
  type CampaignProjectCandidate,
  pickCampaignProject,
} from 'src/modules/enso/inbound-activity/utils/pick-campaign-project.util';

// Applies pickCampaignProject to activities on their way in, so a lead from a
// multi-project page lands on the project its campaign names BEFORE the deal gate
// sees it — attribution runs before deal creation, never inside it.
//
// Wired into the GraphQL create hooks, which is how social DMs, lead ads and forms
// arrive. Calls are deliberately not routed here: they are inserted by the worker
// and get their project later, from the dialled-number map, which is itself an
// explicit per-number decision.
@Injectable()
export class CampaignProjectService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async withCampaignProjects<TRecord extends Record<string, unknown>>(
    authContext: WorkspaceAuthContext,
    records: TRecord[],
  ): Promise<TRecord[]> {
    // Nothing to route without a campaign, so skip the project read entirely —
    // most activities (organic DMs, untagged forms) take this path.
    if (!records.some((record) => typeof record.utmCampaign === 'string')) {
      return records;
    }

    const projects = await this.loadCandidates(authContext);

    if (projects.length === 0) {
      return records;
    }

    return records.map((record) => {
      const projectId = pickCampaignProject({
        utmCampaign: record.utmCampaign,
        currentProjectId:
          typeof record.projectId === 'string' ? record.projectId : null,
        projects,
      });

      return isDefined(projectId) ? { ...record, projectId } : record;
    });
  }

  // Only projects that own at least one campaign can win, but the umbrella flag
  // of the CURRENT project matters too, so every live project is read. The table
  // holds a handful of rows; one read per create batch is cheaper than a cache
  // that could route on a stale mapping after someone edits a project.
  private async loadCandidates(
    authContext: WorkspaceAuthContext,
  ): Promise<CampaignProjectCandidate[]> {
    const workspaceId = authContext.workspace?.id;

    if (!isDefined(workspaceId)) {
      return [];
    }

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository =
          await this.globalWorkspaceOrmManager.getRepository<any>(
            workspaceId,
            'project',
            { shouldBypassPermissionChecks: true },
          );

        const rows: Array<Record<string, unknown>> = await repository.find();

        return rows
          .filter((row) => typeof row.id === 'string')
          .map((row) => ({
            id: row.id as string,
            isUmbrella: row.isUmbrella === true,
            utmCampaigns: Array.isArray(row.utmCampaigns)
              ? row.utmCampaigns.filter(
                  (slug): slug is string => typeof slug === 'string',
                )
              : [],
          }));
      },
      buildSystemAuthContext(workspaceId),
    );
  }
}
