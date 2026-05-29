import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';
import { In, IsNull, Not } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { CLOSED_OPPORTUNITY_STAGES } from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';

export type RoutingResult =
  | { status: 'assigned'; managerId: string; sticky: boolean }
  | { status: 'already_claimed' }
  | { status: 'no_candidates' }
  | { status: 'not_found' };

type OpportunityRow = {
  id: string;
  stage?: string | null;
  ownerId?: string | null;
  projectId?: string | null;
  pointOfContactId?: string | null;
};

type CandidateRow = {
  id: string;
  lastAssignedAt?: Date | string | null;
  activeClientCount: number;
};

// The routing brain. Picks a manager for an opportunity in stage ROUTING:
//   1. honor an existing sticky personProjectAssignment (person × project) if
//      its manager isn't excluded;
//   2. else true round-robin over available managers — oldest lastAssignedAt
//      first, then fewest active clients, then random.
// Sets opportunity.owner and bumps the chosen manager's lastAssignedAt. Does NOT
// write the sticky assignment (that happens on claim) and does NOT touch
// routingCount (the claim-check job owns reroute accounting).
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

        const managerId = await this.pickManager(
          workspaceId,
          opportunity,
          excludedManagerIds,
        );

        if (!isDefined(managerId)) {
          return { status: 'no_candidates' };
        }

        const sticky = await this.hasActiveAssignment(
          workspaceId,
          opportunity,
          managerId,
        );

        await opportunityRepository.update(
          { id: opportunity.id },
          { ownerId: managerId, routingCount: attempt },
        );

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

        this.logger.log(
          `Routed opportunity ${opportunityId} to ${managerId} (sticky=${sticky}).`,
        );

        return { status: 'assigned', managerId, sticky };
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

  // Escalation terminal state: routing exhausted (no candidates or max
  // attempts). Mark the deal stalled so it surfaces in the escalation queue.
  async markStalled(
    authContext: WorkspaceAuthContext,
    opportunityId: string,
  ): Promise<void> {
    const workspaceId = authContext.workspace?.id;

    if (!workspaceId || !isDefined(opportunityId)) {
      return;
    }

    const systemAuthContext = buildSystemAuthContext(workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const opportunityRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'opportunity',
          { shouldBypassPermissionChecks: true },
        );

      await opportunityRepository.update(
        { id: opportunityId },
        { pipelineState: 'STALLED' },
      );
    }, systemAuthContext);
  }

  // Honor a sticky assignment first; else round-robin. Runs inside an existing
  // workspace context.
  private async pickManager(
    workspaceId: string,
    opportunity: OpportunityRow,
    excludedManagerIds: string[],
  ): Promise<string | undefined> {
    const sticky = await this.findStickyManagerId(workspaceId, opportunity);

    if (isDefined(sticky) && !excludedManagerIds.includes(sticky)) {
      return sticky;
    }

    return this.roundRobinPick(workspaceId, excludedManagerIds);
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

  private async hasActiveAssignment(
    workspaceId: string,
    opportunity: OpportunityRow,
    managerId: string,
  ): Promise<boolean> {
    const sticky = await this.findStickyManagerId(workspaceId, opportunity);

    return sticky === managerId;
  }

  // True round-robin over available managers. Project specialization is a no-op
  // today (all managers serve all projects); when a manager × project
  // eligibility set is added, filter candidates by it here.
  private async roundRobinPick(
    workspaceId: string,
    excludedManagerIds: string[],
  ): Promise<string | undefined> {
    const workspaceMemberRepository =
      await this.globalWorkspaceOrmManager.getRepository<any>(
        workspaceId,
        'workspaceMember',
        { shouldBypassPermissionChecks: true },
      );

    const available = await workspaceMemberRepository.find({
      where: { isAvailableForRouting: true },
    });

    const eligible = available.filter(
      (member: { id: string }) => !excludedManagerIds.includes(member.id),
    );

    if (eligible.length === 0) {
      return undefined;
    }

    const opportunityRepository =
      await this.globalWorkspaceOrmManager.getRepository<any>(
        workspaceId,
        'opportunity',
        { shouldBypassPermissionChecks: true },
      );

    const candidates: CandidateRow[] = [];

    for (const member of eligible) {
      const activeClientCount = await opportunityRepository.count({
        where: {
          ownerId: member.id,
          stage: Not(In([...CLOSED_OPPORTUNITY_STAGES])),
        },
      });

      candidates.push({
        id: member.id,
        lastAssignedAt: member.lastAssignedAt ?? null,
        activeClientCount,
      });
    }

    candidates.sort(this.compareCandidates);

    return candidates[0]?.id;
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
