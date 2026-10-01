import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { In, IsNull, LessThan, Repository } from 'typeorm';

import { SentryCronMonitor } from 'src/engine/core-modules/cron/sentry-cron-monitor.decorator';
import { ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import {
  PERSON_RELATIONSHIP_DRAFT_CLEANUP_CRON_PATTERN,
  PERSON_RELATIONSHIP_DRAFT_MAX_AGE_HOURS,
} from 'src/modules/enso/person-relationship/person-relationship.constants';
import { type RelationshipRow } from 'src/modules/enso/person-relationship/utils/plan-partner-sync.util';

// Twenty creates the family-link record the moment a manager clicks "Add new",
// before they pick the relative or the relation type. Drafts left that way
// show up as "Untitled" rows in the Families list. Once a draft has sat
// untouched for a day it was abandoned: move it to trash (recoverable), along
// with any other half still pointing at it.
@Processor(MessageQueue.cronQueue)
export class PersonRelationshipDraftCleanupCronJob {
  private readonly logger = new Logger(
    PersonRelationshipDraftCleanupCronJob.name,
  );

  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly exceptionHandlerService: ExceptionHandlerService,
  ) {}

  @Process(PersonRelationshipDraftCleanupCronJob.name)
  @SentryCronMonitor(
    PersonRelationshipDraftCleanupCronJob.name,
    PERSON_RELATIONSHIP_DRAFT_CLEANUP_CRON_PATTERN,
  )
  async handle(): Promise<void> {
    const workspaces = await this.workspaceRepository.find({
      where: { activationStatus: WorkspaceActivationStatus.ACTIVE },
    });

    for (const workspace of workspaces) {
      try {
        await this.cleanWorkspace(workspace.id);
      } catch (error) {
        this.logger.error(
          `family-link draft cleanup failed for workspace ${workspace.id}: ${(error as Error).message}`,
        );
        this.exceptionHandlerService.captureExceptions([error as Error]);
      }
    }
  }

  private async cleanWorkspace(workspaceId: string): Promise<void> {
    const cutoff = new Date(
      Date.now() - PERSON_RELATIONSHIP_DRAFT_MAX_AGE_HOURS * 60 * 60 * 1000,
    );

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const repository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'personRelationship',
          { shouldBypassPermissionChecks: true },
        );

      const drafts: RelationshipRow[] = await repository.find({
        where: [
          { personId: IsNull(), updatedAt: LessThan(cutoff) },
          { relatedPersonId: IsNull(), updatedAt: LessThan(cutoff) },
          { relationType: IsNull(), updatedAt: LessThan(cutoff) },
        ],
      });

      if (drafts.length === 0) return;

      const draftIds = drafts.map((draft) => draft.id);
      const canonicalIds = drafts
        .map((draft) => draft.mirrorOfId)
        .filter(isDefined);

      const partners: RelationshipRow[] = await repository.find({
        where: [
          { mirrorOfId: In(draftIds) },
          ...(canonicalIds.length > 0 ? [{ id: In(canonicalIds) }] : []),
        ],
      });

      const idsToTrash = [
        ...new Set([...draftIds, ...partners.map((partner) => partner.id)]),
      ];

      await repository.softDelete({ id: In(idsToTrash) });

      this.logger.log(
        `moved ${idsToTrash.length} abandoned family-link row(s) to trash in workspace ${workspaceId}`,
      );
    }, buildSystemAuthContext(workspaceId));
  }
}
