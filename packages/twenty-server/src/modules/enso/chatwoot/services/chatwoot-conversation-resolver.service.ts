import { Injectable } from '@nestjs/common';

import { isDefined, isNonEmptyString } from 'twenty-shared/utils';
import { In } from 'typeorm';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

// One conversation linked to a record, with the CRM context needed for the list
// row (person / opportunity / project / created date).
export type DealConversation = {
  conversationId: string;
  platform: string | null;
  // When the inbound activity occurred ≈ the conversation's first-seen date.
  createdAt: string | null;
  opportunityId: string | null;
  opportunityName: string | null;
  projectId: string | null;
  projectName: string | null;
  personId: string | null;
  personName: string | null;
};

// Resolves the DISTINCT Chatwoot conversations attached to a record, newest
// first (dedup by chatwootConversationId). For an opportunity → that deal's
// conversations; for a person → every conversation across all their deals. Each
// is enriched with opportunity / project / person names for the list view.
@Injectable()
export class ChatwootConversationResolverService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async listForOpportunity(
    workspaceId: string,
    opportunityId: string,
  ): Promise<DealConversation[]> {
    return this.list(workspaceId, { opportunityId });
  }

  async listForPerson(
    workspaceId: string,
    personId: string,
  ): Promise<DealConversation[]> {
    return this.list(workspaceId, { personId });
  }

  async listForRecord(
    workspaceId: string,
    recordType: 'opportunity' | 'person',
    recordId: string,
  ): Promise<DealConversation[]> {
    return recordType === 'person'
      ? this.listForPerson(workspaceId, recordId)
      : this.listForOpportunity(workspaceId, recordId);
  }

  private async list(
    workspaceId: string,
    where: { opportunityId?: string; personId?: string },
  ): Promise<DealConversation[]> {
    const systemAuthContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const activityRepository =
          await this.globalWorkspaceOrmManager.getRepository<any>(
            workspaceId,
            'inboundActivity',
            { shouldBypassPermissionChecks: true },
          );

        const activities = await activityRepository.find({
          where,
          order: { occurredAt: 'DESC', createdAt: 'DESC' },
        });

        const seen = new Set<string>();
        const conversations: DealConversation[] = [];

        for (const activity of activities) {
          const conversationId = activity.chatwootConversationId;

          // Twenty TEXT fields default to '' (not null), so non-social activities
          // (form/call) carry an EMPTY chatwootConversationId — isDefined('') is
          // true, which used to surface a bogus "conversation" and show the tab on
          // every form/call deal. Require a non-empty id.
          if (
            !isNonEmptyString(conversationId) ||
            seen.has(String(conversationId))
          ) {
            continue;
          }

          seen.add(String(conversationId));
          conversations.push({
            conversationId: String(conversationId),
            platform: activity.platform ?? null,
            createdAt: activity.occurredAt
              ? new Date(activity.occurredAt).toISOString()
              : null,
            opportunityId: activity.opportunityId ?? null,
            opportunityName: null,
            projectId: activity.projectId ?? null,
            projectName: null,
            personId: activity.personId ?? null,
            personName: null,
          });
        }

        await this.attachNames(workspaceId, conversations);

        return conversations;
      },
      systemAuthContext,
    );
  }

  // Batch-resolve opportunity / project / person display names.
  private async attachNames(
    workspaceId: string,
    conversations: DealConversation[],
  ): Promise<void> {
    const collect = (key: 'opportunityId' | 'projectId' | 'personId') => [
      ...new Set(
        conversations
          .map((conversation) => conversation[key])
          .filter((id): id is string => isDefined(id)),
      ),
    ];

    const opportunityIds = collect('opportunityId');
    const projectIds = collect('projectId');
    const personIds = collect('personId');

    const repo = (objectName: string) =>
      this.globalWorkspaceOrmManager.getRepository<any>(
        workspaceId,
        objectName,
        { shouldBypassPermissionChecks: true },
      );

    if (opportunityIds.length > 0) {
      const rows = await (
        await repo('opportunity')
      ).find({
        where: { id: In(opportunityIds) },
      });
      const byId = new Map(rows.map((r: any) => [r.id, r.name]));

      for (const c of conversations) {
        if (isDefined(c.opportunityId)) {
          c.opportunityName = byId.get(c.opportunityId) ?? null;
        }
      }
    }

    if (projectIds.length > 0) {
      const rows = await (
        await repo('project')
      ).find({
        where: { id: In(projectIds) },
      });
      const byId = new Map(rows.map((r: any) => [r.id, r.name]));

      for (const c of conversations) {
        if (isDefined(c.projectId)) {
          c.projectName = byId.get(c.projectId) ?? null;
        }
      }
    }

    if (personIds.length > 0) {
      const rows = await (
        await repo('person')
      ).find({
        where: { id: In(personIds) },
      });
      const byId = new Map(
        rows.map((r: any) => [
          r.id,
          `${r.name?.firstName ?? ''} ${r.name?.lastName ?? ''}`.trim() || null,
        ]),
      );

      for (const c of conversations) {
        if (isDefined(c.personId)) {
          c.personName = byId.get(c.personId) ?? null;
        }
      }
    }
  }
}
