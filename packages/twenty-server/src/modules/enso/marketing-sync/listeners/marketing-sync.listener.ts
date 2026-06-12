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
  INBOUND_ACTIVITY_EVENT_BY_KIND,
  type InboundActivityRecord,
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

  // A new deal with a point of contact → deal_created (the introductory
  // journey's entry event). pointOfContactId + projectId are set at creation by
  // the intake (opportunity-resolution), so the person is always attributable
  // here. The job enriches with isFirstDealForPerson + projectBrand.
  @OnDatabaseBatchEvent('opportunity', DatabaseEventAction.CREATED)
  async onOpportunityCreated(
    payload: WorkspaceEventBatch<
      ObjectRecordCreateEvent<OpportunityWorkspaceEntity>
    >,
  ): Promise<void> {
    for (const event of payload.events) {
      const opportunity = event.properties.after;

      // No point of contact → no person to attribute the event to.
      if (!isDefined(opportunity.pointOfContactId)) {
        continue;
      }

      await this.messageQueueService.add<MarketingSyncJobData>(
        MarketingSyncJob.name,
        {
          kind: 'track_deal_created',
          workspaceId: payload.workspaceId,
          userId: opportunity.pointOfContactId,
          opportunityId: event.recordId,
          timestamp: this.toIso(opportunity.createdAt),
          // recordId is unique per deal → idempotent across job retries.
          messageId: `track:deal_created:${event.recordId}`,
        },
      );
    }
  }

  // Lifecycle events: a new inboundActivity (form submit, social DM, call,
  // appointment) → track on the person. form_submitted starts the intro drip;
  // inbound_message is the reply→drip-exit signal. Fires on raw-ORM intake
  // writes too (the ORM emits the event), so the intake pipeline is covered.
  @OnDatabaseBatchEvent('inboundActivity', DatabaseEventAction.CREATED)
  async onInboundActivityCreated(
    payload: WorkspaceEventBatch<
      ObjectRecordCreateEvent<InboundActivityRecord>
    >,
  ): Promise<void> {
    for (const event of payload.events) {
      const activity = event.properties.after;

      // Need a resolved person and a mapped kind to attribute the event.
      if (!isDefined(activity.personId) || !isDefined(activity.kind)) {
        continue;
      }

      const eventName = INBOUND_ACTIVITY_EVENT_BY_KIND[activity.kind];

      if (!isDefined(eventName)) {
        continue;
      }

      const timestamp = this.toIso(activity.occurredAt ?? activity.createdAt);

      await this.messageQueueService.add<MarketingSyncJobData>(
        MarketingSyncJob.name,
        {
          kind: 'track',
          workspaceId: payload.workspaceId,
          userId: activity.personId,
          event: eventName,
          properties: {
            inboundActivityId: event.recordId,
            inboundKind: activity.kind,
            source: activity.source,
            opportunityId: activity.opportunityId,
            projectId: activity.projectId,
          },
          timestamp,
          // recordId is unique per activity → idempotent across job retries.
          messageId: `track:inbound:${event.recordId}`,
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
