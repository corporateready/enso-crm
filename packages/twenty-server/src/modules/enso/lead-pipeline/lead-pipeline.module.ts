import { Module } from '@nestjs/common';

import { InboundActivityCreateOnePostQueryHook } from 'src/modules/enso/lead-pipeline/query-hooks/inbound-activity-create-one.post-query-hook';
import { OpportunityUpdateOnePostQueryHook } from 'src/modules/enso/lead-pipeline/query-hooks/opportunity-update-one.post-query-hook';
import { OpportunityClaimService } from 'src/modules/enso/lead-pipeline/services/opportunity-claim.service';
import { PersonProjectAssignmentNameService } from 'src/modules/enso/person-project-assignment/services/person-project-assignment-name.service';

// SERVER side of the lead pipeline: the two POST query hooks. The inbound hook
// only enqueues (pipeline trigger); the opportunity hook writes the sticky
// assignment on claim. Imported by WorkspaceQueryHookModule so the query-hook
// explorer discovers them. The worker-side jobs live in LeadPipelineJobsModule
// (loaded by JobsModule) — the worker boots QueueWorkerModule, which does NOT
// import the query-hook graph, so jobs must be registered there separately.
@Module({
  providers: [
    InboundActivityCreateOnePostQueryHook,
    OpportunityUpdateOnePostQueryHook,
    OpportunityClaimService,
    // Reused (stateless) to label sticky assignments created on claim.
    PersonProjectAssignmentNameService,
  ],
})
export class LeadPipelineModule {}
