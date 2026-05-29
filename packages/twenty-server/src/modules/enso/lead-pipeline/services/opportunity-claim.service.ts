import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';
import { IsNull } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { SYSTEM_ACTOR } from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';
import { PersonProjectAssignmentNameService } from 'src/modules/enso/person-project-assignment/services/person-project-assignment-name.service';

// When an opportunity is claimed (leaves ROUTING with an owner), make that
// manager the sticky owner of the (person × project) so future inquiries route
// straight to them. Stickiness is written on CLAIM, not on tentative
// assignment — a rerouted/never-claimed manager never becomes sticky.
// Idempotent: a no-op if the active assignment already names this manager.
@Injectable()
export class OpportunityClaimService {
  private readonly logger = new Logger(OpportunityClaimService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly personProjectAssignmentNameService: PersonProjectAssignmentNameService,
  ) {}

  async syncStickyAssignment(
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

      const opportunity = await opportunityRepository.findOne({
        where: { id: opportunityId },
      });

      // Only act on claimed deals that have all three sides of the assignment.
      if (
        !opportunity ||
        opportunity.stage === 'ROUTING' ||
        !isDefined(opportunity.ownerId) ||
        !isDefined(opportunity.pointOfContactId) ||
        !isDefined(opportunity.projectId)
      ) {
        return;
      }

      const assignmentRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'personProjectAssignment',
          { shouldBypassPermissionChecks: true },
        );

      const existing = await assignmentRepository.findOne({
        where: {
          personId: opportunity.pointOfContactId,
          projectId: opportunity.projectId,
          endedAt: IsNull(),
        },
        order: { assignedAt: 'DESC' },
      });

      // Already sticky to this manager — nothing to do.
      if (existing?.managerId === opportunity.ownerId) {
        return;
      }

      const name = await this.personProjectAssignmentNameService.computeName(
        authContext,
        {
          projectId: opportunity.projectId,
          managerId: opportunity.ownerId,
        },
      );

      if (existing) {
        // Owner changed — repoint the active assignment.
        await assignmentRepository.update(
          { id: existing.id },
          {
            managerId: opportunity.ownerId,
            assignedAt: new Date(),
            ...(isDefined(name) ? { name } : {}),
          },
        );

        return;
      }

      const lastPosition = await assignmentRepository.maximum(
        'position',
        undefined,
      );

      await assignmentRepository.insert({
        personId: opportunity.pointOfContactId,
        projectId: opportunity.projectId,
        managerId: opportunity.ownerId,
        assignedAt: new Date(),
        position: (lastPosition ?? 0) + 1,
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
        ...(isDefined(name) ? { name } : {}),
      });

      this.logger.log(
        `Sticky assignment set: person ${opportunity.pointOfContactId} × project ${opportunity.projectId} → ${opportunity.ownerId}.`,
      );
    }, systemAuthContext);
  }
}
