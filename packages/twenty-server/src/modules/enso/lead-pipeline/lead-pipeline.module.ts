import { Module } from '@nestjs/common';

import { ClaimCheckJob } from 'src/modules/enso/lead-pipeline/jobs/claim-check.job';
import { NotifyManagerAssignmentJob } from 'src/modules/enso/lead-pipeline/jobs/notify-manager-assignment.job';
import { ResolveOpportunityFromActivityJob } from 'src/modules/enso/lead-pipeline/jobs/resolve-opportunity-from-activity.job';
import { RouteOpportunityJob } from 'src/modules/enso/lead-pipeline/jobs/route-opportunity.job';
import { InboundActivityCreateOnePostQueryHook } from 'src/modules/enso/lead-pipeline/query-hooks/inbound-activity-create-one.post-query-hook';
import { OpportunityUpdateOnePostQueryHook } from 'src/modules/enso/lead-pipeline/query-hooks/opportunity-update-one.post-query-hook';
import { ManagerNotificationService } from 'src/modules/enso/lead-pipeline/services/manager-notification.service';
import { OpportunityClaimService } from 'src/modules/enso/lead-pipeline/services/opportunity-claim.service';
import { OpportunityNameService } from 'src/modules/enso/lead-pipeline/services/opportunity-name.service';
import { OpportunityResolutionService } from 'src/modules/enso/lead-pipeline/services/opportunity-resolution.service';
import { OpportunityRoutingService } from 'src/modules/enso/lead-pipeline/services/opportunity-routing.service';
import { PersonProjectAssignmentNameService } from 'src/modules/enso/person-project-assignment/services/person-project-assignment-name.service';

// The inbound-activity → opportunity → routing pipeline. Two POST query hooks
// (pipeline trigger + claim→sticky) and four BullMQ jobs (resolve → route →
// notify, plus the delayed claim-check/reroute) on the ensoLeadPipelineQueue.
// Discovery is global (the query-hook explorer + the message-queue explorer
// both scan all providers), so importing this module once into
// WorkspaceQueryHookModule registers both the hooks and the worker jobs.
@Module({
  providers: [
    OpportunityNameService,
    OpportunityResolutionService,
    OpportunityRoutingService,
    ManagerNotificationService,
    OpportunityClaimService,
    // Reused (stateless) to label sticky assignments created on claim.
    PersonProjectAssignmentNameService,
    ResolveOpportunityFromActivityJob,
    RouteOpportunityJob,
    NotifyManagerAssignmentJob,
    ClaimCheckJob,
    InboundActivityCreateOnePostQueryHook,
    OpportunityUpdateOnePostQueryHook,
  ],
})
export class LeadPipelineModule {}
