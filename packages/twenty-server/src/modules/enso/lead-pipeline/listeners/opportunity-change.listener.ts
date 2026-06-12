import { Injectable } from '@nestjs/common';

import { type ObjectRecordUpdateEvent } from 'twenty-shared/database-events';
import { isDefined } from 'twenty-shared/utils';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { type ManagerNotifyJobData } from 'src/modules/enso/lead-pipeline/jobs/lead-pipeline-job.types';
import { ManagerNotifyJob } from 'src/modules/enso/lead-pipeline/jobs/manager-notify.job';

// Owner change → tell the former owner (lead lost / reassigned). Stage/state
// change made by someone OTHER than the owner (a teammate or ENSO automation) →
// tell the owner. The owner's OWN edits are skipped (no self-notification), and
// the ROUTING→claim transition is left to the assignment notification.
@Injectable()
export class OpportunityChangeListener {
  constructor(
    @InjectMessageQueue(MessageQueue.ensoLeadPipelineQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {}

  @OnDatabaseBatchEvent('opportunity', DatabaseEventAction.UPDATED)
  async handleUpdated(
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    payload: WorkspaceEventBatch<ObjectRecordUpdateEvent<any>>,
  ): Promise<void> {
    const workspaceId = payload.workspaceId;

    for (const event of payload.events) {
      const before = event.properties.before;
      const after = event.properties.after;
      const updatedFields = event.properties.updatedFields ?? [];
      const opportunityId = event.recordId;

      if (
        updatedFields.includes('ownerId') &&
        isDefined(before?.ownerId) &&
        before.ownerId !== after?.ownerId
      ) {
        await this.enqueue({
          workspaceId,
          kind: 'lost_reassigned',
          opportunityId,
          managerId: before.ownerId,
        });
      }

      const stageOrStateChanged =
        updatedFields.includes('stage') ||
        updatedFields.includes('pipelineState');
      const ownerId = after?.ownerId;

      if (stageOrStateChanged && isDefined(ownerId)) {
        const actorIsOwner =
          isDefined(event.workspaceMemberId) &&
          event.workspaceMemberId === ownerId;
        // The claim (ROUTING → out) is already covered by the assignment card.
        const isRoutingClaim =
          before?.stage === 'ROUTING' && after?.stage !== 'ROUTING';

        if (!actorIsOwner && !isRoutingClaim) {
          await this.enqueue({
            workspaceId,
            kind: 'deal_state_changed',
            opportunityId,
            managerId: ownerId,
            transition: this.deriveTransition(before, after, updatedFields),
            newStage: updatedFields.includes('stage')
              ? after?.stage
              : undefined,
          });
        }
      }
    }
  }

  private deriveTransition(
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    before: any,
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    after: any,
    updatedFields: string[],
  ): 'stalled' | 'deferred' | 'active' | 'stage' {
    if (
      updatedFields.includes('pipelineState') &&
      before?.pipelineState !== after?.pipelineState
    ) {
      const state = String(after?.pipelineState ?? '').toUpperCase();

      if (state === 'STALLED') {
        return 'stalled';
      }
      if (state === 'DEFERRED') {
        return 'deferred';
      }
      if (state === 'ACTIVE') {
        return 'active';
      }
    }

    return 'stage';
  }

  private async enqueue(data: ManagerNotifyJobData): Promise<void> {
    await this.messageQueueService.add<ManagerNotifyJobData>(
      ManagerNotifyJob.name,
      data,
    );
  }
}
