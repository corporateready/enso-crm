import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type MetaAudienceInput } from 'src/modules/enso/marketing-sync/dtos/meta-audience.input';
import { MetaAudienceClientService } from 'src/modules/enso/marketing-sync/services/meta-audience-client.service';
import { buildEnsoTimelineInserts } from 'src/modules/enso/timeline/enso-timeline.util';

// Relays a Dittofeed "add to Meta audience" journey step to the Meta Marketing
// API and records a timeline event on the person. Consent gating happens in
// Dittofeed (the journey node is assigned to a marketing subscription group), so
// only consented people ever reach this relay.
@Injectable()
export class MarketingMetaService {
  private readonly logger = new Logger(MarketingMetaService.name);

  constructor(
    private readonly metaAudienceClientService: MetaAudienceClientService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async addToAudience(input: MetaAudienceInput): Promise<void> {
    await this.metaAudienceClientService.addUser(input.workspaceId, {
      email: input.email,
      phone: input.phone,
    });

    if (isDefined(input.userId)) {
      await this.writeTimeline(input.workspaceId, input.userId);
    }
  }

  // Best-effort: a timeline failure must not fail the audience add.
  private async writeTimeline(
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    try {
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const timelineRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'timelineActivity',
              { shouldBypassPermissionChecks: true },
            );

          const rows = buildEnsoTimelineInserts({
            action: 'marketing-meta-audience',
            target: { personId: userId },
            segments: [{ text: 'Added to the Meta retargeting audience' }],
            auto: true,
            happensAt: new Date().toISOString(),
          });

          if (rows.length > 0) {
            await timelineRepository.insert(rows);
          }
        },
        buildSystemAuthContext(workspaceId),
      );
    } catch (error) {
      this.logger.warn(
        `Meta audience timeline write failed for person ${userId}: ${
          (error as Error).message
        }`,
      );
    }
  }
}
