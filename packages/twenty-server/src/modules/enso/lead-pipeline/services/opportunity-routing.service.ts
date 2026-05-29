import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';
import { IsNull } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

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

// The routing brain. For an opportunity in stage ROUTING:
//   1. sticky personProjectAssignment (person × project) exists → assign that
//      manager and AUTO-CLAIM (stage = LEAD_CLAIMED). Sticky wins even if the
//      manager is currently offline — it's their client.
//   2. else pick UNIFORMLY AT RANDOM among managers who are BOTH accepting leads
//      (isAvailableForRouting) AND assigned to the deal's project
//      (projectRoutingMember).
//
// The pick is **per-opportunity and independent** — there is no org-wide rotation
// counter or "least-recently-assigned" state. We do NOT compensate managers who
// were offline (no catch-up) and do NOT balance load. Being online keeps you in
// every draw (so the always-online get the most leads); going offline just drops
// you from the pool. What happens on one deal never influences another.
// On reroute, the per-deal `excludedManagerIds` (carried in the job payload, not
// stored) skips already-tried managers so a single deal cycles through the pool
// before repeating — still entirely per-opportunity.
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
    _attempt = 0,
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

        // (2) Random pick over available + project-eligible managers.
        const managerId = await this.pickCandidate(
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
            // re-picking the same manager (only one online) is not a change.
            routingCount: this.nextRoutingCount(opportunity, managerId),
          },
        );

        this.logger.log(`Routed opportunity ${opportunityId} to ${managerId}.`);

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
  // the first assignee as 1. Only a real owner change increments it; re-picking
  // the same manager (e.g. they're the only one online) does not.
  private nextRoutingCount(
    opportunity: OpportunityRow,
    nextManagerId: string,
  ): number {
    const current = opportunity.routingCount ?? 0;
    const ownerChanged = opportunity.ownerId !== nextManagerId;

    return ownerChanged ? current + 1 : current;
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

  // Per-opportunity, independent uniform-random pick over the project's routing
  // pool: members accepting leads (isAvailableForRouting) AND assigned to this
  // project (active projectRoutingMember). NO org-wide rotation/least-recently
  // state, NO load balancing, NO offline catch-up. The per-deal
  // `excludedManagerIds` skips already-tried managers so one deal cycles through
  // the pool before repeating; once everyone's been tried it resets (re-picks).
  // Returns undefined ONLY when the pool is truly empty (nobody online+eligible)
  // → the deal parks and is retried.
  private async pickCandidate(
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

    const candidates: string[] = available
      .map((member: { id: string }) => member.id)
      .filter((id: string) => eligibleManagerIds.has(id));

    if (candidates.length === 0) {
      return undefined; // nobody online for this project → park + retry
    }

    // Per-deal rotation without replacement: prefer managers not yet tried on
    // THIS deal; once all have been tried, reset and re-pick from the full pool.
    let pool = candidates.filter((id) => !excludedManagerIds.includes(id));

    if (pool.length === 0) {
      pool = candidates;
    }

    // Uniform random — independent draw per opportunity, no shared state.
    return pool[Math.floor(Math.random() * pool.length)];
  }
}
