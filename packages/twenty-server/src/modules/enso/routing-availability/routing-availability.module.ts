import { Module } from '@nestjs/common';

import { WorkspaceMemberUpdateOnePreQueryHook } from 'src/modules/enso/routing-availability/query-hooks/workspace-member-update-one.pre-query-hook';
import { EnsoPostHogService } from 'src/modules/enso/routing-availability/services/enso-posthog.service';
import { RoutingAvailabilityAuditService } from 'src/modules/enso/routing-availability/services/routing-availability-audit.service';

@Module({
  providers: [
    EnsoPostHogService,
    RoutingAvailabilityAuditService,
    WorkspaceMemberUpdateOnePreQueryHook,
  ],
})
export class RoutingAvailabilityModule {}
