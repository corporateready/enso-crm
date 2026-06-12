import { Module } from '@nestjs/common';

import { GoogleChatWebhookModule } from 'src/modules/enso/notifications/google-chat-webhook.module';
import { ClaimCheckJob } from 'src/modules/enso/lead-pipeline/jobs/claim-check.job';
import { NotifyManagerAssignmentJob } from 'src/modules/enso/lead-pipeline/jobs/notify-manager-assignment.job';
import { ResolveOpportunityFromActivityJob } from 'src/modules/enso/lead-pipeline/jobs/resolve-opportunity-from-activity.job';
import { RouteOpportunityJob } from 'src/modules/enso/lead-pipeline/jobs/route-opportunity.job';
import { ConsentFromActivityService } from 'src/modules/enso/lead-pipeline/services/consent-from-activity.service';
import { ManagerNotificationService } from 'src/modules/enso/lead-pipeline/services/manager-notification.service';
import { OpportunityNameService } from 'src/modules/enso/lead-pipeline/services/opportunity-name.service';
import { OpportunityResolutionService } from 'src/modules/enso/lead-pipeline/services/opportunity-resolution.service';
import { OpportunityRoutingService } from 'src/modules/enso/lead-pipeline/services/opportunity-routing.service';
import { PersonFirstTouchService } from 'src/modules/enso/lead-pipeline/services/person-first-touch.service';
import { PersonTimelineService } from 'src/modules/enso/lead-pipeline/services/person-timeline.service';
import { ConsentEventService } from 'src/modules/enso/person-project-consent/services/consent-event.service';
import { PersonProjectConsentNameService } from 'src/modules/enso/person-project-consent/services/person-project-consent-name.service';

// WORKER side of the lead pipeline: the four BullMQ jobs (resolve → route →
// notify + the delayed claim-check) and the services they depend on. Imported
// by JobsModule, which the queue worker (QueueWorkerModule) loads — that's where
// the message-queue explorer discovers @Processor classes. The server-side POST
// hooks live in LeadPipelineModule.
@Module({
  imports: [GoogleChatWebhookModule],
  providers: [
    OpportunityNameService,
    OpportunityResolutionService,
    OpportunityRoutingService,
    PersonFirstTouchService,
    PersonTimelineService,
    ConsentFromActivityService,
    PersonProjectConsentNameService,
    ConsentEventService,
    ManagerNotificationService,
    ResolveOpportunityFromActivityJob,
    RouteOpportunityJob,
    NotifyManagerAssignmentJob,
    ClaimCheckJob,
  ],
})
export class LeadPipelineJobsModule {}
