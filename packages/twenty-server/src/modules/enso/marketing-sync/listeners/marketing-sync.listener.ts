import { Injectable } from '@nestjs/common';

import {
  type ObjectRecordCreateEvent,
  type ObjectRecordUpdateEvent,
} from 'twenty-shared/database-events';
import { isDefined } from 'twenty-shared/utils';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { objectRecordChangedProperties } from 'src/engine/core-modules/event-emitter/utils/object-record-changed-properties.util';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { MarketingSyncJob } from 'src/modules/enso/marketing-sync/jobs/marketing-sync.job';
import {
  buildPersonTraits,
  MARKETING_EVENT_DEAL_STAGE_CHANGED,
  type MarketingSyncJobData,
} from 'src/modules/enso/marketing-sync/marketing-sync.constants';
import { type OpportunityWorkspaceEntity } from 'src/modules/opportunity/standard-objects/opportunity.workspace-entity';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';

// Person fields that map to Dittofeed traits — a person update only re-syncs
// when one of these actually changes (avoids re-identifying on unrelated edits).
const TRAIT_FIELDS = new Set([
  'name',
  'emails',
  'phones',
  'city',
  'jobTitle',
  'companyId',
]);

// CRM → Dittofeed connection (connection #1 in the spec). Listens to the
// workspace event bus — which the TwentyORM layer emits on for BOTH GraphQL
// writes and raw ORM saves — so intake-pipeline and scanner-created records are
// covered, not just GraphQL mutations. The listener only builds payloads +
// enqueues; the worker job does the Dittofeed HTTP call (with retries).
@Injectable()
export class MarketingSyncListener {
  constructor(
    @InjectMessageQueue(MessageQueue.ensoMarketingSyncQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {}

  @OnDatabaseBatchEvent('person', DatabaseEventAction.CREATED)
  async onPersonCreated(
    payload: WorkspaceEventBatch<ObjectRecordCreateEvent<PersonWorkspaceEntity>>,
  ): Promise<void> {
    for (const event of payload.events) {
      await this.enqueueIdentify(
        payload.workspaceId,
        event.recordId,
        event.properties.after,
      );
    }
  }

  @OnDatabaseBatchEvent('person', DatabaseEventAction.UPDATED)
  async onPersonUpdated(
    payload: WorkspaceEventBatch<ObjectRecordUpdateEvent<PersonWorkspaceEntity>>,
  ): Promise<void> {
    for (const event of payload.events) {
      const changed = objectRecordChangedProperties(
        event.properties.before,
        event.properties.after,
      );

      if (!changed.some((field) => TRAIT_FIELDS.has(field))) {
        continue;
      }

      await this.enqueueIdentify(
        payload.workspaceId,
        event.recordId,
        event.properties.after,
      );
    }
  }

  @OnDatabaseBatchEvent('opportunity', DatabaseEventAction.UPDATED)
  async onOpportunityUpdated(
    payload: WorkspaceEventBatch<
      ObjectRecordUpdateEvent<OpportunityWorkspaceEntity>
    >,
  ): Promise<void> {
    for (const event of payload.events) {
      const { before, after } = event.properties;

      if (before.stage === after.stage) {
        continue;
      }

      // No point of contact → no person to attribute the event to.
      if (!isDefined(after.pointOfContactId)) {
        continue;
      }

      const timestamp = this.toIso(after.updatedAt);

      await this.messageQueueService.add<MarketingSyncJobData>(
        MarketingSyncJob.name,
        {
          kind: 'track',
          workspaceId: payload.workspaceId,
          userId: after.pointOfContactId,
          event: MARKETING_EVENT_DEAL_STAGE_CHANGED,
          properties: {
            opportunityId: event.recordId,
            fromStage: before.stage,
            toStage: after.stage,
            amount: after.amount,
          },
          timestamp,
          messageId: `track:deal_stage_changed:${event.recordId}:${timestamp}`,
        },
      );
    }
  }

  private async enqueueIdentify(
    workspaceId: string,
    personId: string,
    person: PersonWorkspaceEntity,
  ): Promise<void> {
    const timestamp = this.toIso(person.updatedAt ?? person.createdAt);

    await this.messageQueueService.add<MarketingSyncJobData>(
      MarketingSyncJob.name,
      {
        kind: 'identify',
        workspaceId,
        userId: personId,
        traits: buildPersonTraits(person),
        messageId: `identify:${personId}:${timestamp}`,
      },
    );
  }

  private toIso(value: Date | string | null | undefined): string {
    if (!isDefined(value)) {
      return new Date(0).toISOString();
    }

    return new Date(value).toISOString();
  }
}
