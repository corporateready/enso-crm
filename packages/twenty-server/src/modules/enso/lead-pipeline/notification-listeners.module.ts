import { Module } from '@nestjs/common';

import { ConsentChangeListener } from 'src/modules/enso/lead-pipeline/listeners/consent-change.listener';
import { OpportunityChangeListener } from 'src/modules/enso/lead-pipeline/listeners/opportunity-change.listener';
import { TaskAssignmentListener } from 'src/modules/enso/lead-pipeline/listeners/task-assignment.listener';

// Server-side @OnDatabaseBatchEvent listeners for the Phase 2 manager
// notifications. Must be imported by ModulesModule (the main app graph) so the
// event-emitter discovery registers them — the query-hook graph that loads
// LeadPipelineModule does NOT register @OnEvent listeners. The listeners only
// enqueue ManagerNotifyJob (worker posts), so the queue + ORM manager (both
// global) are all they need.
@Module({
  providers: [
    OpportunityChangeListener,
    TaskAssignmentListener,
    ConsentChangeListener,
  ],
})
export class EnsoNotificationListenersModule {}
