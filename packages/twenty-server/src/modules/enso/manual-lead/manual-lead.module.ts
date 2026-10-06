import { Module } from '@nestjs/common';

import { InboundActivityNameService } from 'src/modules/enso/inbound-activity/services/inbound-activity-name.service';
import { ManagerNotificationService } from 'src/modules/enso/lead-pipeline/services/manager-notification.service';
import { OpportunityClaimService } from 'src/modules/enso/lead-pipeline/services/opportunity-claim.service';
import { OpportunityNameService } from 'src/modules/enso/lead-pipeline/services/opportunity-name.service';
import { OpportunityResolutionService } from 'src/modules/enso/lead-pipeline/services/opportunity-resolution.service';
import { ManualLeadResolver } from 'src/modules/enso/manual-lead/resolvers/manual-lead.resolver';
import { ManualLeadDuplicateService } from 'src/modules/enso/manual-lead/services/manual-lead-duplicate.service';
import { ManualLeadService } from 'src/modules/enso/manual-lead/services/manual-lead.service';
import { GoogleChatWebhookModule } from 'src/modules/enso/notifications/google-chat-webhook.module';
import { PersonProjectAssignmentNameService } from 'src/modules/enso/person-project-assignment/services/person-project-assignment-name.service';
import { EnsoPostHogService } from 'src/modules/enso/routing-availability/services/enso-posthog.service';

// Imported by CoreEngineModule, not ModulesModule: a @MetadataResolver only
// reaches the metadata GraphQL schema from the CoreEngineModule graph, and a
// resolver in the wrong graph fails silently.
//
// Deal resolution runs here, in the server, rather than in the worker like for
// webhook intake: the manager is waiting for the deal and must hear right away
// if the lead could not be added. So every service it reaches is listed here as
// well as in LeadPipelineJobsModule — the graphs resolve independently, and a
// dependency missing from one crashes that process at boot.
@Module({
  imports: [GoogleChatWebhookModule],
  providers: [
    ManualLeadResolver,
    ManualLeadService,
    ManualLeadDuplicateService,
    InboundActivityNameService,
    OpportunityResolutionService,
    OpportunityNameService,
    OpportunityClaimService,
    PersonProjectAssignmentNameService,
    ManagerNotificationService,
    EnsoPostHogService,
  ],
})
export class ManualLeadModule {}
