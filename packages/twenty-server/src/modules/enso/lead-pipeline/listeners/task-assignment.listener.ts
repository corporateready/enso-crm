import { Injectable } from '@nestjs/common';

import {
  type ObjectRecordCreateEvent,
  type ObjectRecordUpdateEvent,
} from 'twenty-shared/database-events';
import { isDefined } from 'twenty-shared/utils';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { type ManagerNotifyJobData } from 'src/modules/enso/lead-pipeline/jobs/lead-pipeline-job.types';
import { ManagerNotifyJob } from 'src/modules/enso/lead-pipeline/jobs/manager-notify.job';

// A task assigned to a manager (on create, e.g. by the sequencing engine, or
// when reassigned) → notify them. Skip self-assignment (you assigning yourself a
// task is not news).
@Injectable()
export class TaskAssignmentListener {
  constructor(
    @InjectMessageQueue(MessageQueue.ensoLeadPipelineQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {}

  @OnDatabaseBatchEvent('task', DatabaseEventAction.CREATED)
  async handleCreated(
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    payload: WorkspaceEventBatch<ObjectRecordCreateEvent<any>>,
  ): Promise<void> {
    for (const event of payload.events) {
      await this.notifyAssignee(
        payload.workspaceId,
        event.recordId,
        event.properties.after?.assigneeId,
        event.workspaceMemberId,
      );
    }
  }

  @OnDatabaseBatchEvent('task', DatabaseEventAction.UPDATED)
  async handleUpdated(
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    payload: WorkspaceEventBatch<ObjectRecordUpdateEvent<any>>,
  ): Promise<void> {
    for (const event of payload.events) {
      if (!(event.properties.updatedFields ?? []).includes('assigneeId')) {
        continue;
      }

      await this.notifyAssignee(
        payload.workspaceId,
        event.recordId,
        event.properties.after?.assigneeId,
        event.workspaceMemberId,
      );
    }
  }

  private async notifyAssignee(
    workspaceId: string,
    taskId: string,
    assigneeId: string | null | undefined,
    actorWorkspaceMemberId: string | undefined,
  ): Promise<void> {
    if (!isDefined(assigneeId)) {
      return;
    }

    // Self-assignment isn't news.
    if (
      isDefined(actorWorkspaceMemberId) &&
      actorWorkspaceMemberId === assigneeId
    ) {
      return;
    }

    const data: ManagerNotifyJobData = {
      workspaceId,
      kind: 'task_assigned',
      taskId,
      managerId: assigneeId,
    };

    await this.messageQueueService.add<ManagerNotifyJobData>(
      ManagerNotifyJob.name,
      data,
    );
  }
}
