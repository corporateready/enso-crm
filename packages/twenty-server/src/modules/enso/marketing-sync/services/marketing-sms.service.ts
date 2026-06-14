import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type SendSmsInput } from 'src/modules/enso/marketing-sync/dtos/send-sms.input';
import { SmsMdClientService } from 'src/modules/enso/marketing-sync/services/sms-md-client.service';
import { buildEnsoTimelineInserts } from 'src/modules/enso/timeline/enso-timeline.util';

// Relays a Dittofeed SMS journey step to sms.md and records a timeline event on
// the person, so the sales manager sees the SMS alongside the rest of the
// marketing journey (the whole point of the in-CRM visibility layer).
@Injectable()
export class MarketingSmsService {
  private readonly logger = new Logger(MarketingSmsService.name);

  constructor(
    private readonly smsMdClientService: SmsMdClientService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async send(input: SendSmsInput): Promise<void> {
    await this.smsMdClientService.send(input.workspaceId, {
      to: input.to,
      message: input.message,
    });

    if (isDefined(input.userId)) {
      await this.writeTimeline(input.workspaceId, input.userId);
    }
  }

  // Best-effort: a timeline failure must not fail the SMS send.
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
            action: 'marketing-sms-sent',
            target: { personId: userId },
            segments: [{ text: 'Sent a marketing SMS' }],
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
        `marketing SMS timeline write failed for person ${userId}: ${
          (error as Error).message
        }`,
      );
    }
  }
}
