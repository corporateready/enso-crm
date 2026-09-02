import { Injectable, Logger } from '@nestjs/common';

import { randomUUID } from 'crypto';

import { isDefined } from 'twenty-shared/utils';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { SYSTEM_ACTOR } from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';
import { PBX_NUMBER_REFRESH_INTERVAL_MS } from 'src/modules/enso/telephony/telephony.constants';

type PbxNumberRow = {
  id: string;
  name?: string | null;
  did?: string | null;
  pbxGroup?: string | null;
  projectCodeOverride?: string | null;
  lastSeenAt?: Date | string | null;
  position: number;
  createdBy?: { source: string; name: string; context?: object } | null;
  updatedBy?: { source: string; name: string; context?: object } | null;
};

type PbxNumberRepository = WorkspaceRepository<PbxNumberRow>;

// Keeps the DID → department mapping current without anyone maintaining a list.
//
// The PBX's own dial plan is not reachable over the token API (only the web
// cabinet has it), so a hand-maintained map of numbers goes stale silently the
// moment a number is added to a department. But every `event` push carries BOTH
// the dialled number and the department it rang, so the mapping can simply be
// learned from live traffic: a new number is unmapped for its first call and
// correct from the second onward.
//
// That leaves only the department → project map as configuration — a handful of
// entries that change rarely — instead of one entry per number.
@Injectable()
export class PbxNumberService {
  private readonly logger = new Logger(PbxNumberService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async lookup(
    workspaceId: string,
    did: string,
  ): Promise<{ pbxGroup?: string; projectCodeOverride?: string } | undefined> {
    const row = await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository = await this.getRepository(workspaceId);

        return repository.findOne({ where: { did } });
      },
      buildSystemAuthContext(workspaceId),
    );

    if (!isDefined(row)) {
      return undefined;
    }

    return {
      ...(isDefined(row.pbxGroup) && row.pbxGroup
        ? { pbxGroup: row.pbxGroup }
        : {}),
      ...(isDefined(row.projectCodeOverride) && row.projectCodeOverride
        ? { projectCodeOverride: row.projectCodeOverride }
        : {}),
    };
  }

  // Called on every push that names both a number and a department. Best-effort:
  // learning is a side benefit of ingest, never a reason to fail it.
  async learn(
    workspaceId: string,
    did: string | undefined,
    pbxGroup: string | undefined,
  ): Promise<void> {
    if (!isDefined(did) || !did || !isDefined(pbxGroup) || !pbxGroup) {
      return;
    }

    try {
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const repository = await this.getRepository(workspaceId);
          const existing = await repository.findOne({ where: { did } });

          if (!isDefined(existing)) {
            const lastPosition = await repository.maximum(
              'position',
              undefined,
            );

            await repository.insert({
              id: randomUUID(),
              name: did,
              did,
              pbxGroup,
              lastSeenAt: new Date(),
              position: (lastPosition ?? 0) + 1,
              createdBy: SYSTEM_ACTOR,
              updatedBy: SYSTEM_ACTOR,
            });

            this.logger.log(`Learned new PBX number ${did} → ${pbxGroup}`);

            return;
          }

          // A department change is the case worth catching quickly — it silently
          // re-points a number at a different project.
          const groupChanged = existing.pbxGroup !== pbxGroup;

          // Otherwise throttle: one call produces several pushes, and touching
          // the row on each would be pure write amplification.
          const lastSeen = isDefined(existing.lastSeenAt)
            ? new Date(existing.lastSeenAt).getTime()
            : 0;
          const stale = Date.now() - lastSeen > PBX_NUMBER_REFRESH_INTERVAL_MS;

          if (!groupChanged && !stale) {
            return;
          }

          if (groupChanged) {
            this.logger.log(
              `PBX number ${did} moved department: ${existing.pbxGroup ?? '(none)'} → ${pbxGroup}`,
            );
          }

          await repository.update(
            { id: existing.id },
            {
              ...(groupChanged ? { pbxGroup } : {}),
              lastSeenAt: new Date(),
              updatedBy: SYSTEM_ACTOR,
            },
          );
        },
        buildSystemAuthContext(workspaceId),
      );
    } catch (error) {
      this.logger.warn(
        `Could not record PBX number ${did}: ${(error as Error).message}`,
      );
    }
  }

  private async getRepository(
    workspaceId: string,
  ): Promise<PbxNumberRepository> {
    return this.globalWorkspaceOrmManager.getRepository<PbxNumberRow>(
      workspaceId,
      'pbxNumber',
      { shouldBypassPermissionChecks: true },
    );
  }
}
