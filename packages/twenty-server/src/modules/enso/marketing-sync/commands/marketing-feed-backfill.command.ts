import { Logger } from '@nestjs/common';

import { Command, CommandRunner, Option } from 'nest-commander';
import { isDefined } from 'twenty-shared/utils';
import {
  Between,
  type FindOptionsOrder,
  type FindOptionsWhere,
  IsNull,
  Not,
} from 'typeorm';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { MarketingSyncJob } from 'src/modules/enso/marketing-sync/jobs/marketing-sync.job';
import {
  buildPersonTraits,
  INBOUND_ACTIVITY_EVENT_BY_KIND,
  MARKETING_EVENT_DEAL_STAGE_CHANGED,
  type InboundActivityRecord,
  type MarketingSyncJobData,
  type PersonProjectConsentRecord,
} from 'src/modules/enso/marketing-sync/marketing-sync.constants';
import { type OpportunityWorkspaceEntity } from 'src/modules/opportunity/standard-objects/opportunity.workspace-entity';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

// Re-emits the CRM → Dittofeed feed for a past window, for when Dittofeed was
// unreachable and the listener's jobs failed. Dittofeed was down from
// 2026-06-29 to 2026-09-15 and the client throws on HTTP failure, so ~2.9k
// identify/track/consent pushes were lost with nothing surfacing in the CRM.
//
// It deliberately stands in for the LISTENER, not the job: it rebuilds the same
// MarketingSyncJobData payloads and enqueues them on the same queue, so
// MarketingSyncJob still resolves a project's subscription groups and enriches
// deal_created (first-deal flag, projectName/projectCode) itself. Nothing that
// segments key on is recomputed here, because a backfill that disagreed with
// the live path would be worse than no backfill.
//
// Safe to re-run: every messageId is the one the listener would have produced,
// and Dittofeed dedupes on it.
//
// Two streams are deliberately CURRENT-state rather than a replay of history:
//
//   identify     — one push per person carrying today's traits. Replaying each
//                  historical edit would write stale intermediate values for no
//                  gain; the newest state is the only one anyone wants.
//   sync_consent — the job pushes a person's whole subscription state from the
//                  consent row, latest-write-wins. Using the row as it stands
//                  now is what makes a revocation that happened DURING the gap
//                  win, instead of being overwritten by an older grant.
//
// deal_stage_changed is the one stream that genuinely needs history (it carries
// fromStage/toStage), and it is recovered from the timelineActivity diff the
// CRM already writes for every record update.

type MarketingFeedBackfillOptions = {
  workspaceId?: string;
  since?: string;
  until?: string;
  streams?: string;
  dryRun?: boolean;
};

const ALL_STREAMS = [
  'identify',
  'deal-created',
  'inbound',
  'stage-changed',
  'consent',
] as const;

type Stream = (typeof ALL_STREAMS)[number];

// Workspace entities type datetime columns as ISO strings, not Dates, so every
// window filter below is built with Between(from.toISOString(), …).

// Rows are read in pages so a multi-thousand-record window never loads at once.
const PAGE_SIZE = 200;

// The timeline row the CRM writes for a record update; `properties.diff` holds
// the before/after of every changed column, which is where a stage transition
// survives.
type TimelineActivityRow = {
  name: string | null;
  targetOpportunityId: string | null;
  happensAt: string | null;
  createdAt: string | null;
  properties: {
    diff?: Record<string, { before?: unknown; after?: unknown }>;
  } | null;
};

// The constants' payload types describe what the LISTENER reads off an event,
// so they lack the row columns a query filters on (id / deletedAt). These add
// them back for the custom objects, which have no generated entity class.
type InboundActivityRow = InboundActivityRecord & {
  id: string;
  deletedAt: Date | null;
};

type PersonProjectConsentRow = PersonProjectConsentRecord & {
  createdAt: string | null;
  deletedAt: Date | null;
};

@Command({
  name: 'enso:marketing:backfill-feed',
  description:
    'Re-emits the CRM → Dittofeed feed (identify/track/consent) for a past window, for when Dittofeed was unreachable.',
})
export class MarketingFeedBackfillCommand extends CommandRunner {
  private readonly logger = new Logger(MarketingFeedBackfillCommand.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    @InjectMessageQueue(MessageQueue.ensoMarketingSyncQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {
    super();
  }

  @Option({
    flags: '--workspace-id <workspaceId>',
    description: 'Workspace to backfill (required).',
  })
  parseWorkspaceId(value: string): string {
    return value;
  }

  @Option({
    flags: '--since <since>',
    description:
      'Start of the window, ISO 8601 (required), e.g. 2026-06-29T12:43:00Z.',
  })
  parseSince(value: string): string {
    return value;
  }

  @Option({
    flags: '--until <until>',
    description: 'End of the window, ISO 8601. Defaults to now.',
  })
  parseUntil(value: string): string {
    return value;
  }

  @Option({
    flags: '--streams <streams>',
    description: `Comma-separated subset of: ${ALL_STREAMS.join(', ')}. Defaults to all.`,
  })
  parseStreams(value: string): string {
    return value;
  }

  @Option({
    flags: '--dry-run',
    description: 'Count what would be enqueued without enqueuing anything.',
  })
  parseDryRun(): boolean {
    return true;
  }

  async run(
    _passedParams: string[],
    options: MarketingFeedBackfillOptions,
  ): Promise<void> {
    const { workspaceId, since, until, streams, dryRun } = options;

    if (!isDefined(workspaceId) || !isDefined(since)) {
      this.logger.error('--workspace-id and --since are both required.');

      return;
    }

    const from = new Date(since);
    const to = isDefined(until) ? new Date(until) : new Date();

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      this.logger.error('--since / --until must be valid ISO 8601 dates.');

      return;
    }

    const selected = this.resolveStreams(streams);

    if (!isDefined(selected)) {
      return;
    }

    this.logger.log(
      `Backfilling ${selected.join(', ')} for workspace ${workspaceId} over ${from.toISOString()} → ${to.toISOString()}${
        dryRun === true ? ' (DRY RUN)' : ''
      }`,
    );

    const counts: Record<string, number> = {};

    if (selected.includes('identify')) {
      counts.identify = await this.backfillIdentify(
        workspaceId,
        from,
        to,
        dryRun === true,
      );
    }

    if (selected.includes('deal-created')) {
      counts['deal-created'] = await this.backfillDealCreated(
        workspaceId,
        from,
        to,
        dryRun === true,
      );
    }

    if (selected.includes('inbound')) {
      counts.inbound = await this.backfillInboundActivity(
        workspaceId,
        from,
        to,
        dryRun === true,
      );
    }

    if (selected.includes('stage-changed')) {
      counts['stage-changed'] = await this.backfillStageChanged(
        workspaceId,
        from,
        to,
        dryRun === true,
      );
    }

    if (selected.includes('consent')) {
      counts.consent = await this.backfillConsent(
        workspaceId,
        from,
        to,
        dryRun === true,
      );
    }

    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

    this.logger.log(
      `${dryRun === true ? 'Would enqueue' : 'Enqueued'} ${total} job(s): ${Object.entries(
        counts,
      )
        .map(([stream, n]) => `${stream}=${n}`)
        .join(' ')}`,
    );
  }

  private resolveStreams(streams: string | undefined): Stream[] | undefined {
    if (!isDefined(streams)) {
      return [...ALL_STREAMS];
    }

    const requested = streams
      .split(',')
      .map((stream) => stream.trim())
      .filter((stream) => stream.length > 0);

    const unknown = requested.filter(
      (stream) => !ALL_STREAMS.includes(stream as Stream),
    );

    if (unknown.length > 0) {
      this.logger.error(
        `Unknown stream(s): ${unknown.join(', ')}. Valid: ${ALL_STREAMS.join(', ')}`,
      );

      return undefined;
    }

    return requested as Stream[];
  }

  // Current traits per person touched in the window. The messageId matches what
  // the listener would emit for the person's latest update, so a real update
  // arriving later supersedes this rather than colliding with it.
  private async backfillIdentify(
    workspaceId: string,
    from: Date,
    to: Date,
    dryRun: boolean,
  ): Promise<number> {
    return this.forEachPage<PersonWorkspaceEntity>(
      workspaceId,
      'person',
      {
        updatedAt: Between(from.toISOString(), to.toISOString()),
        deletedAt: IsNull(),
      },
      async (person) => {
        const timestamp = this.toIso(person.updatedAt ?? person.createdAt);

        await this.enqueue(
          {
            kind: 'identify',
            workspaceId,
            userId: person.id,
            traits: buildPersonTraits(person),
            messageId: `identify:${person.id}:${timestamp}`,
          },
          dryRun,
        );
      },
    );
  }

  private async backfillDealCreated(
    workspaceId: string,
    from: Date,
    to: Date,
    dryRun: boolean,
  ): Promise<number> {
    return this.forEachPage<OpportunityWorkspaceEntity>(
      workspaceId,
      'opportunity',
      {
        createdAt: Between(from.toISOString(), to.toISOString()),
        deletedAt: IsNull(),
        pointOfContactId: Not(IsNull()),
      },
      async (opportunity) => {
        // Guarded by the query, but the ORM row type still allows null.
        if (!isDefined(opportunity.pointOfContactId)) {
          return;
        }

        await this.enqueue(
          {
            kind: 'track_deal_created',
            workspaceId,
            userId: opportunity.pointOfContactId,
            opportunityId: opportunity.id,
            timestamp: this.toIso(opportunity.createdAt),
            messageId: `track:deal_created:${opportunity.id}`,
          },
          dryRun,
        );
      },
    );
  }

  private async backfillInboundActivity(
    workspaceId: string,
    from: Date,
    to: Date,
    dryRun: boolean,
  ): Promise<number> {
    return this.forEachPage<InboundActivityRow>(
      workspaceId,
      'inboundActivity',
      {
        createdAt: Between(from.toISOString(), to.toISOString()),
        deletedAt: IsNull(),
        personId: Not(IsNull()),
      },
      async (activity) => {
        if (!isDefined(activity.personId) || !isDefined(activity.kind)) {
          return;
        }

        const eventName = INBOUND_ACTIVITY_EVENT_BY_KIND[activity.kind];

        // An unmapped kind is not a marketing event; the listener skips it too.
        if (!isDefined(eventName)) {
          return;
        }

        const timestamp = this.toIso(activity.occurredAt ?? activity.createdAt);

        await this.enqueue(
          {
            kind: 'track',
            workspaceId,
            userId: activity.personId,
            event: eventName,
            properties: {
              inboundActivityId: activity.id,
              inboundKind: activity.kind,
              source: activity.source,
              opportunityId: activity.opportunityId,
              projectId: activity.projectId,
            },
            timestamp,
            messageId: `track:inbound:${activity.id}`,
          },
          dryRun,
        );
      },
    );
  }

  // The only stream that needs real history: fromStage/toStage are recovered
  // from the record-update timeline row's diff, which the CRM writes for every
  // update regardless of Dittofeed.
  private async backfillStageChanged(
    workspaceId: string,
    from: Date,
    to: Date,
    dryRun: boolean,
  ): Promise<number> {
    const pointOfContactByOpportunityId = new Map<string, string>();

    return this.forEachPage<TimelineActivityRow>(
      workspaceId,
      'timelineActivity',
      {
        createdAt: Between(from.toISOString(), to.toISOString()),
        name: 'opportunity.updated',
        targetOpportunityId: Not(IsNull()),
      },
      async (row) => {
        const stageDiff = row.properties?.diff?.stage;
        const opportunityId = row.targetOpportunityId;

        if (!isDefined(stageDiff) || !isDefined(opportunityId)) {
          return;
        }

        const pointOfContactId = await this.resolvePointOfContact(
          workspaceId,
          opportunityId,
          pointOfContactByOpportunityId,
        );

        // No point of contact → no person to attribute the event to, same as
        // the listener.
        if (!isDefined(pointOfContactId)) {
          return;
        }

        const timestamp = this.toIso(row.happensAt ?? row.createdAt);

        await this.enqueue(
          {
            kind: 'track',
            workspaceId,
            userId: pointOfContactId,
            event: MARKETING_EVENT_DEAL_STAGE_CHANGED,
            properties: {
              opportunityId,
              fromStage: stageDiff.before,
              toStage: stageDiff.after,
            },
            timestamp,
            messageId: `track:deal_stage_changed:${opportunityId}:${timestamp}`,
          },
          dryRun,
        );
      },
    );
  }

  // Current consent state per row touched in the window. revokedChannels is
  // empty because the job uses it only to choose a log severity — the
  // subscription state it pushes is derived entirely from the row.
  private async backfillConsent(
    workspaceId: string,
    from: Date,
    to: Date,
    dryRun: boolean,
  ): Promise<number> {
    return this.forEachPage<PersonProjectConsentRow>(
      workspaceId,
      'personProjectConsent',
      {
        updatedAt: Between(from.toISOString(), to.toISOString()),
        deletedAt: IsNull(),
      },
      async (consent) => {
        if (!isDefined(consent.personId) || !isDefined(consent.projectId)) {
          return;
        }

        const timestamp = this.toIso(consent.updatedAt);

        await this.enqueue(
          {
            kind: 'sync_consent',
            workspaceId,
            userId: consent.personId,
            projectId: consent.projectId,
            consent,
            revokedChannels: [],
            messageId: `sync_consent:${consent.id}:${timestamp}`,
          },
          dryRun,
        );
      },
    );
  }

  private async resolvePointOfContact(
    workspaceId: string,
    opportunityId: string,
    cache: Map<string, string>,
  ): Promise<string | undefined> {
    const cached = cache.get(opportunityId);

    if (isDefined(cached)) {
      return cached;
    }

    const opportunity =
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const repository =
            await this.globalWorkspaceOrmManager.getRepository<OpportunityWorkspaceEntity>(
              workspaceId,
              'opportunity',
              { shouldBypassPermissionChecks: true },
            );

          return repository.findOne({ where: { id: opportunityId } });
        },
        buildSystemAuthContext(workspaceId),
      );

    const pointOfContactId = opportunity?.pointOfContactId;

    if (!isDefined(pointOfContactId)) {
      return undefined;
    }

    cache.set(opportunityId, pointOfContactId);

    return pointOfContactId;
  }

  // Pages through one object's matching rows, calling `handle` per row, and
  // returns how many rows were handled.
  private async forEachPage<TRow extends { createdAt?: unknown }>(
    workspaceId: string,
    objectName: string,
    where: FindOptionsWhere<TRow>,
    handle: (row: TRow) => Promise<void>,
  ): Promise<number> {
    let handled = 0;
    let skip = 0;

    for (;;) {
      const rows: TRow[] =
        await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
          async () => {
            const repository =
              await this.globalWorkspaceOrmManager.getRepository<TRow>(
                workspaceId,
                objectName,
                { shouldBypassPermissionChecks: true },
              );

            return repository.find({
              where,
              // Every object here has createdAt; TRow is too open for the
              // mapped FindOptionsOrder to see it.
              order: { createdAt: 'ASC' } as FindOptionsOrder<TRow>,
              take: PAGE_SIZE,
              skip,
            });
          },
          buildSystemAuthContext(workspaceId),
        );

      if (rows.length === 0) {
        return handled;
      }

      for (const row of rows) {
        await handle(row);
        handled += 1;
      }

      skip += rows.length;
    }
  }

  private async enqueue(
    data: MarketingSyncJobData,
    dryRun: boolean,
  ): Promise<void> {
    if (dryRun) {
      return;
    }

    await this.messageQueueService.add<MarketingSyncJobData>(
      MarketingSyncJob.name,
      data,
    );
  }

  private toIso(value: Date | string | null | undefined): string {
    if (!isDefined(value)) {
      return new Date().toISOString();
    }

    return value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();
  }
}
