import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';
import { In, IsNull, Not } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { CLOSED_OPPORTUNITY_STAGES } from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';

export type RoutingResult =
  // assigned: owner set. autoClaimed=true means a sticky owner took it straight
  // to LEAD_CLAIMED (no claim window). sticky=true on either claim path.
  | {
      status: 'assigned';
      managerId: string;
      sticky: boolean;
      autoClaimed: boolean;
    }
  | { status: 'already_claimed' }
  // no_candidates = the project's routing pool is empty (nobody assigned to it is
  // currently accepting leads). The deal is "parked" in ROUTING and retried.
  | { status: 'no_candidates' }
  | { status: 'not_found' };

type OpportunityRow = {
  id: string;
  stage?: string | null;
  ownerId?: string | null;
  projectId?: string | null;
  pointOfContactId?: string | null;
  routingCount?: number | null;
};

type CandidateRow = {
  id: string;
  lastAssignedAt?: Date | string | null;
  activeClientCount: number;
};

// The routing brain. For an opportunity in stage ROUTING:
//   1. sticky personProjectAssignment (person × project) exists → assign that
//      manager and AUTO-CLAIM (stage = LEAD_CLAIMED). Sticky wins even if the
//      manager is currently offline — it's their client.
//   2. else round-robin over managers who are BOTH accepting leads
//      (isAvailableForRouting) AND assigned to the deal's project
//      (projectRoutingMember). Oldest lastAssignedAt → fewest active clients →
//      random. Sets owner (stage stays ROUTING; a claim window opens).
// Sets owner + bumps lastAssignedAt; increments routingCount on each owner
// change during ROUTING (first assignee = 1).
@Injectable()
export class OpportunityRoutingService {
  private readonly logger = new Logger(OpportunityRoutingService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async routeOpportunity(
    authContext: WorkspaceAuthContext,
    opportunityId: string,
    excludedManagerIds: string[] = [],
    attempt = 0,
  ): Promise<RoutingResult> {
    const workspaceId = authContext.workspace?.id;

    if (!workspaceId || !isDefined(opportunityId)) {
      return { status: 'not_found' };
    }

    const systemAuthContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const opportunityRepository =
          await this.globalWorkspaceOrmManager.getRepository<any>(
            workspaceId,
            'opportunity',
            { shouldBypassPermissionChecks: true },
          );

        const opportunity: OpportunityRow | null =
          await opportunityRepository.findOne({ where: { id: opportunityId } });

        if (!opportunity) {
          return { status: 'not_found' };
        }

        // Only route deals still in ROUTING — a manual claim/stage change wins.
        if (opportunity.stage !== 'ROUTING') {
          return { status: 'already_claimed' };
        }

        // (1) Sticky → auto-claim straight to LEAD_CLAIMED (even if offline).
        const stickyManagerId = await this.findStickyManagerId(
          workspaceId,
          opportunity,
        );

        if (isDefined(stickyManagerId)) {
          await opportunityRepository.update(
            { id: opportunity.id },
            {
              ownerId: stickyManagerId,
              stage: 'LEAD_CLAIMED',
              // routingCount counts owner changes during ROUTING (first = 1).
              routingCount: this.nextRoutingCount(opportunity, stickyManagerId),
            },
          );
          await this.bumpLastAssigned(workspaceId, stickyManagerId);

          this.logger.log(
            `Opportunity ${opportunityId} auto-claimed by sticky manager ${stickyManagerId}.`,
          );

          return {
            status: 'assigned',
            managerId: stickyManagerId,
            sticky: true,
            autoClaimed: true,
          };
        }

        // (2) Round-robin over available + project-eligible managers.
        const managerId = await this.roundRobinPick(
          workspaceId,
          opportunity.projectId,
          excludedManagerIds,
        );

        if (!isDefined(managerId)) {
          return { status: 'no_candidates' };
        }

        await opportunityRepository.update(
          { id: opportunity.id },
          {
            ownerId: managerId,
            // routingCount counts owner changes during ROUTING (first = 1);
            // re-pinging the same manager (only one online) is not a change.
            routingCount: this.nextRoutingCount(opportunity, managerId),
          },
        );
        await this.bumpLastAssigned(workspaceId, managerId);

        this.logger.log(
          `Routed opportunity ${opportunityId} to ${managerId} (attempt ${attempt}).`,
        );

        return {
          status: 'assigned',
          managerId,
          sticky: false,
          autoClaimed: false,
        };
      },
      systemAuthContext,
    );
  }

  // Current stage of an opportunity (null if missing). Used by the claim-check
  // job to decide claimed-vs-reroute without re-running the full router.
  async getOpportunityStage(
    authContext: WorkspaceAuthContext,
    opportunityId: string,
  ): Promise<string | null> {
    const workspaceId = authContext.workspace?.id;

    if (!workspaceId || !isDefined(opportunityId)) {
      return null;
    }

    const systemAuthContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const opportunityRepository =
          await this.globalWorkspaceOrmManager.getRepository<any>(
            workspaceId,
            'opportunity',
            { shouldBypassPermissionChecks: true },
          );

        const opportunity = await opportunityRepository.findOne({
          where: { id: opportunityId },
        });

        return opportunity?.stage ?? null;
      },
      systemAuthContext,
    );
  }

  // routingCount = number of owner changes while the deal is in ROUTING, with
  // the first assignee as 1. Only a real owner change increments it; re-pinging
  // the same manager (e.g. they're the only one online) does not.
  private nextRoutingCount(
    opportunity: OpportunityRow,
    nextManagerId: string,
  ): number {
    const current = opportunity.routingCount ?? 0;
    const ownerChanged = opportunity.ownerId !== nextManagerId;

    return ownerChanged ? current + 1 : current;
  }

  private async bumpLastAssigned(
    workspaceId: string,
    managerId: string,
  ): Promise<void> {
    const workspaceMemberRepository =
      await this.globalWorkspaceOrmManager.getRepository<any>(
        workspaceId,
        'workspaceMember',
        { shouldBypassPermissionChecks: true },
      );

    await workspaceMemberRepository.update(
      { id: managerId },
      { lastAssignedAt: new Date() },
    );
  }

  private async findStickyManagerId(
    workspaceId: string,
    opportunity: OpportunityRow,
  ): Promise<string | undefined> {
    if (
      !isDefined(opportunity.pointOfContactId) ||
      !isDefined(opportunity.projectId)
    ) {
      return undefined;
    }

    const assignmentRepository =
      await this.globalWorkspaceOrmManager.getRepository<any>(
        workspaceId,
        'personProjectAssignment',
        { shouldBypassPermissionChecks: true },
      );

    const assignment = await assignmentRepository.findOne({
      where: {
        personId: opportunity.pointOfContactId,
        projectId: opportunity.projectId,
        endedAt: IsNull(),
      },
      order: { assignedAt: 'DESC' },
    });

    return assignment?.managerId ?? undefined;
  }

  // Round-robin over the project's routing pool: members who are accepting leads
  // (isAvailableForRouting) AND assigned to this project (active
  // projectRoutingMember). Exclusion is SOFT — we prefer not to re-pick the
  // just-assigned manager (to rotate), but if they're the only one online we
  // re-ping them rather than park. Returns undefined ONLY when the pool is truly
  // empty (nobody online+eligible) → the deal parks and is retried.
  private async roundRobinPick(
    workspaceId: string,
    projectId: string | null | undefined,
    excludedManagerIds: string[],
  ): Promise<string | undefined> {
    if (!isDefined(projectId)) {
      return undefined;
    }

    const routingMemberRepository =
      await this.globalWorkspaceOrmManager.getRepository<any>(
        workspaceId,
        'projectRoutingMember',
        { shouldBypassPermissionChecks: true },
      );

    const routingMembers = await routingMemberRepository.find({
      where: { projectId, isActive: true },
    });

    const eligibleManagerIds = new Set<string>(
      routingMembers
        .map((member: { managerId?: string | null }) => member.managerId)
        .filter((id: string | null | undefined): id is string => isDefined(id)),
    );

    if (eligibleManagerIds.size === 0) {
      return undefined; // no managers assigned to this project's routing
    }

    const workspaceMemberRepository =
      await this.globalWorkspaceOrmManager.getRepository<any>(
        workspaceId,
        'workspaceMember',
        { shouldBypassPermissionChecks: true },
      );

    const available = await workspaceMemberRepository.find({
      where: { isAvailableForRouting: true },
    });

    const candidates = available.filter((member: { id: string }) =>
      eligibleManagerIds.has(member.id),
    );

    if (candidates.length === 0) {
      return undefined; // nobody online for this project → park + retry
    }

    // Soft exclusion: rotate away from the just-assigned manager when possible.
    let pool = candidates.filter(
      (member: { id: string }) => !excludedManagerIds.includes(member.id),
    );

    if (pool.length === 0) {
      pool = candidates; // only the excluded manager is online → re-ping them
    }

    const opportunityRepository =
      await this.globalWorkspaceOrmManager.getRepository<any>(
        workspaceId,
        'opportunity',
        { shouldBypassPermissionChecks: true },
      );

    const ranked: CandidateRow[] = [];

    for (const member of pool) {
      const activeClientCount = await opportunityRepository.count({
        where: {
          ownerId: member.id,
          stage: Not(In([...CLOSED_OPPORTUNITY_STAGES])),
        },
      });

      ranked.push({
        id: member.id,
        lastAssignedAt: member.lastAssignedAt ?? null,
        activeClientCount,
      });
    }

    ranked.sort(this.compareCandidates);

    return ranked[0]?.id;
  }

  // Oldest lastAssignedAt first (never-assigned = oldest), then fewest active
  // clients, then random tiebreak — the rebuild of legacy's Math.random pick.
  private compareCandidates = (a: CandidateRow, b: CandidateRow): number => {
    const aTime = a.lastAssignedAt ? new Date(a.lastAssignedAt).getTime() : 0;
    const bTime = b.lastAssignedAt ? new Date(b.lastAssignedAt).getTime() : 0;

    if (aTime !== bTime) {
      return aTime - bTime;
    }

    if (a.activeClientCount !== b.activeClientCount) {
      return a.activeClientCount - b.activeClientCount;
    }

    return Math.random() - 0.5;
  };
}
