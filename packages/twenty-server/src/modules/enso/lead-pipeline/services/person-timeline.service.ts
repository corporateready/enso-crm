import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

// Workspace-specific object metadata ids (single prod workspace). Used as the
// timelineActivity.linkedObjectMetadataId so the front can resolve the linked
// object type + build the record link.
const INBOUND_ACTIVITY_OBJECT_METADATA_ID =
  'cef40992-41c4-4742-8b4c-234777a1b8c6';
const OPPORTUNITY_OBJECT_METADATA_ID = 'a71b2bcb-9380-4b84-9f94-b6ddc19b103b';

// Surfaces related-record events on the PERSON's Timeline. Twenty natively only
// writes timeline activities for notes/tasks, so an inbound activity arriving or
// an opportunity being created never shows on the person's timeline. We write a
// person-targeted timelineActivity (targetPerson = the person) that LINKS the
// activity/opportunity via the generic linkedRecord* fields — the same shape the
// note/task timeline uses. Best-effort: never fails the pipeline.
@Injectable()
export class PersonTimelineService {
  private readonly logger = new Logger(PersonTimelineService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async recordInboundActivity(
    workspaceId: string,
    activityId: string,
  ): Promise<void> {
    await this.run(workspaceId, async () => {
      const activity = await this.find(workspaceId, 'inboundActivity', activityId);

      if (
        !activity ||
        activity.isSynthetic === true ||
        !isDefined(activity.personId)
      ) {
        return;
      }

      await this.writeOnPerson(workspaceId, {
        personId: activity.personId,
        name: 'linked-inboundActivity.created',
        linkedObjectMetadataId: INBOUND_ACTIVITY_OBJECT_METADATA_ID,
        linkedRecordId: activity.id,
        cachedName: activity.name ?? '',
        happensAt: activity.occurredAt ?? activity.createdAt,
      });
    });
  }

  async recordOpportunityCreated(
    workspaceId: string,
    opportunityId: string,
  ): Promise<void> {
    await this.run(workspaceId, async () => {
      const opportunity = await this.find(workspaceId, 'opportunity', opportunityId);

      if (!opportunity || !isDefined(opportunity.pointOfContactId)) {
        return;
      }

      await this.writeOnPerson(workspaceId, {
        personId: opportunity.pointOfContactId,
        name: 'linked-opportunity.created',
        linkedObjectMetadataId: OPPORTUNITY_OBJECT_METADATA_ID,
        linkedRecordId: opportunity.id,
        cachedName: opportunity.name ?? '',
        happensAt: opportunity.createdAt,
      });
    });
  }

  private async writeOnPerson(
    workspaceId: string,
    params: {
      personId: string;
      name: string;
      linkedObjectMetadataId: string;
      linkedRecordId: string;
      cachedName: string;
      happensAt: Date | string | null;
    },
  ): Promise<void> {
    const repository = await this.globalWorkspaceOrmManager.getRepository<any>(
      workspaceId,
      'timelineActivity',
      { shouldBypassPermissionChecks: true },
    );

    await repository.insert({
      targetPersonId: params.personId,
      name: params.name,
      happensAt: params.happensAt ?? new Date().toISOString(),
      properties: {},
      linkedObjectMetadataId: params.linkedObjectMetadataId,
      linkedRecordId: params.linkedRecordId,
      linkedRecordCachedName: params.cachedName,
    });
  }

  private async find(
    workspaceId: string,
    objectName: string,
    id: string,
  ): Promise<any> {
    const repository = await this.globalWorkspaceOrmManager.getRepository<any>(
      workspaceId,
      objectName,
      { shouldBypassPermissionChecks: true },
    );

    return repository.findOne({ where: { id } });
  }

  private async run(
    workspaceId: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    if (!workspaceId) {
      return;
    }

    try {
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        fn,
        buildSystemAuthContext(workspaceId),
      );
    } catch (error) {
      this.logger.warn(
        `Person timeline write failed: ${(error as Error).message}`,
      );
    }
  }
}
