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
const CONSENT_EVENT_OBJECT_METADATA_ID =
  'e4644363-2cb7-43d5-931e-8af41e583831';

// Channel code → human label for the timeline summary line.
const CHANNEL_LABEL: Record<string, string> = {
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  call: 'Call',
};

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

  // Aggregated consent change (one row per grant/revoke, listing the channels)
  // surfaced on the person's main timeline, linked to a representative consent
  // event so the row opens the audit record. Called from BOTH the pipeline grant
  // and the manual edit hook.
  async recordConsentChange(
    workspaceId: string,
    params: {
      personId: string;
      projectId?: string | null;
      consentEventId: string;
      action: 'GRANTED' | 'REVOKED';
      channels: string[]; // lowercase channel keys
      detail?: string | null; // source (grant) or method (revoke) label
      // The manager who made a manual change; absent for pipeline (system) grants
      // so the row reads "by <workspace>" for those.
      workspaceMemberId?: string | null;
      // true for pipeline/system grants → row reads "automatically" instead of
      // "by <someone>".
      auto?: boolean;
      happensAt?: string | null;
    },
  ): Promise<void> {
    await this.run(workspaceId, async () => {
      if (
        !isDefined(params.personId) ||
        !isDefined(params.consentEventId) ||
        params.channels.length === 0
      ) {
        return;
      }

      const channelList = params.channels
        .map((channel) => CHANNEL_LABEL[channel] ?? channel)
        .join(', ');

      let projectName: string | null = null;

      if (isDefined(params.projectId)) {
        const project = await this.find(
          workspaceId,
          'project',
          params.projectId,
        );

        projectName = project?.name ?? null;
      }

      // The clickable label = channels · project; the "how" (source/method) is
      // carried in properties so the row can render it as "· via <detail>".
      const cachedName = [channelList, projectName]
        .filter(isDefined)
        .filter((part) => part !== '')
        .join(' · ');

      await this.writeOnPerson(workspaceId, {
        personId: params.personId,
        name: `linked-personProjectConsentEvent.${params.action.toLowerCase()}`,
        linkedObjectMetadataId: CONSENT_EVENT_OBJECT_METADATA_ID,
        linkedRecordId: params.consentEventId,
        cachedName,
        happensAt: params.happensAt ?? new Date().toISOString(),
        properties: {
          ...(isDefined(params.detail) ? { detail: params.detail } : {}),
          ...(params.auto === true ? { auto: true } : {}),
        },
        workspaceMemberId: params.workspaceMemberId ?? null,
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
      properties?: Record<string, unknown>;
      workspaceMemberId?: string | null;
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
      properties: params.properties ?? {},
      linkedObjectMetadataId: params.linkedObjectMetadataId,
      linkedRecordId: params.linkedRecordId,
      linkedRecordCachedName: params.cachedName,
      ...(isDefined(params.workspaceMemberId)
        ? { workspaceMemberId: params.workspaceMemberId }
        : {}),
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
