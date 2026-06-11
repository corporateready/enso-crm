import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { SequencingScannerCronCommand } from 'src/modules/enso/sequencing/commands/sequencing-scanner.cron.command';
import { SequencingScannerCronJob } from 'src/modules/enso/sequencing/jobs/sequencing-scanner.cron.job';

// Time-based half of the sequencing engine: the scanner cron (cadence follow-ups,
// stall, auto-close). Event-driven first-touch + reply->Connected live in workflows.
@Module({
  imports: [TypeOrmModule.forFeature([WorkspaceEntity])],
  providers: [SequencingScannerCronJob, SequencingScannerCronCommand],
  exports: [SequencingScannerCronCommand],
})
export class EnsoSequencingModule {}
