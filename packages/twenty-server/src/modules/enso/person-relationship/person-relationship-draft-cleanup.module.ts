import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { PersonRelationshipDraftCleanupCronCommand } from 'src/modules/enso/person-relationship/commands/person-relationship-draft-cleanup.cron.command';
import { PersonRelationshipDraftCleanupCronJob } from 'src/modules/enso/person-relationship/jobs/person-relationship-draft-cleanup.cron.job';

// The abandoned family-link draft cleanup + its registration command. Imported
// by ModulesModule and JobsModule (so the worker runs the @Processor job) and
// by DatabaseCommandModule (so cron:register:all can schedule it), mirroring
// EnsoTaskDueModule.
@Module({
  imports: [TypeOrmModule.forFeature([WorkspaceEntity])],
  providers: [
    PersonRelationshipDraftCleanupCronJob,
    PersonRelationshipDraftCleanupCronCommand,
  ],
  exports: [PersonRelationshipDraftCleanupCronCommand],
})
export class EnsoPersonRelationshipDraftCleanupModule {}
