import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { KeyValuePairModule } from 'src/engine/core-modules/key-value-pair/key-value-pair.module';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { TaskDueScannerCronCommand } from 'src/modules/enso/notifications/commands/task-due-scanner.cron.command';
import { TaskDueScannerCronJob } from 'src/modules/enso/notifications/jobs/task-due-scanner.cron.job';

// Phase 2b: the task-due cron scanner + its registration command. Imported by
// ModulesModule (so the worker runs the @Processor job) and by
// DatabaseCommandModule (so cron:register:all can schedule it), mirroring
// EnsoSequencingModule.
@Module({
  imports: [TypeOrmModule.forFeature([WorkspaceEntity]), KeyValuePairModule],
  providers: [TaskDueScannerCronJob, TaskDueScannerCronCommand],
  exports: [TaskDueScannerCronCommand],
})
export class EnsoTaskDueModule {}
