import { Injectable } from '@nestjs/common';

import {
  type ObjectRecordCreateEvent,
  type ObjectRecordUpdateEvent,
} from 'twenty-shared/database-events';
import { isDefined } from 'twenty-shared/utils';
import { IsNull } from 'typeorm';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { type ManagerNotifyJobData } from 'src/modules/enso/lead-pipeline/jobs/lead-pipeline-job.types';
import { ManagerNotifyJob } from 'src/modules/enso/lead-pipeline/jobs/manager-notify.job';

// Consent changed for a person on a project → notify the manager who owns that
// person×project (the active personProjectAssignment). No assignment → nobody
// to tell, so skip.
@Injectable()
export class ConsentChangeListener {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    @InjectMessageQueue(MessageQueue.ensoLeadPipelineQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {}

  @OnDatabaseBatchEvent('personProjectConsent', DatabaseEventAction.CREATED)
  async handleCreated(
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    payload: WorkspaceEventBatch<ObjectRecordCreateEvent<any>>,
  ): Promise<void> {
    for (const event of payload.events) {
      await this.notifyAssignedManager(
        payload.workspaceId,
        event.properties.after?.personId,
        event.properties.after?.projectId,
      );
    }
  }

  @OnDatabaseBatchEvent('personProjectConsent', DatabaseEventAction.UPDATED)
  async handleUpdated(
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    payload: WorkspaceEventBatch<ObjectRecordUpdateEvent<any>>,
  ): Promise<void> {
    for (const event of payload.events) {
      await this.notifyAssignedManager(
        payload.workspaceId,
        event.properties.after?.personId,
        event.properties.after?.projectId,
      );
    }
  }

  private async notifyAssignedManager(
    workspaceId: string,
    personId: string | null | undefined,
    projectId: string | null | undefined,
  ): Promise<void> {
    if (!isDefined(personId) || !isDefined(projectId)) {
      return;
    }

    const managerId = await this.resolveAssignedManagerId(
      workspaceId,
      personId,
      projectId,
    );

    if (!isDefined(managerId)) {
      return;
    }

    const data: ManagerNotifyJobData = {
      workspaceId,
      kind: 'consent_changed',
      personId,
      projectId,
      managerId,
    };

    await this.messageQueueService.add<ManagerNotifyJobData>(
      ManagerNotifyJob.name,
      data,
    );
  }

  private async resolveAssignedManagerId(
    workspaceId: string,
    personId: string,
    projectId: string,
  ): Promise<string | undefined> {
    const systemAuthContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const assignmentRepository =
          await this.globalWorkspaceOrmManager.getRepository<any>(
            workspaceId,
            'personProjectAssignment',
            { shouldBypassPermissionChecks: true },
          );

        const assignment = await assignmentRepository.findOne({
          where: { personId, projectId, endedAt: IsNull() },
          order: { assignedAt: 'DESC' },
        });

        return assignment?.managerId ?? undefined;
      },
      systemAuthContext,
    );
  }
}
