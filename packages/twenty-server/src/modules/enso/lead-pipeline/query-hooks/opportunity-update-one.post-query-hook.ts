import { Injectable } from '@nestjs/common';

import { type WorkspacePostQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';

import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { WorkspaceQueryHookType } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/types/workspace-query-hook.type';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { extractRowRefs } from 'src/modules/enso/person-relationship/query-hooks/extract-row-refs.util';
import { OpportunityClaimService } from 'src/modules/enso/lead-pipeline/services/opportunity-claim.service';

// When a manager claims a deal — any update that leaves it out of ROUTING with
// an owner — record the sticky person × project assignment. Idempotent and
// re-fetches the row (the hook payload's fields depend on the GraphQL
// selection set, so we only trust the id). The pending claim-check job is
// idempotent and self-cancels (it no-ops once stage != ROUTING), so no explicit
// timer cancellation is needed here.
@Injectable()
@WorkspaceQueryHook({
  key: `opportunity.updateOne`,
  type: WorkspaceQueryHookType.POST_HOOK,
})
export class OpportunityUpdateOnePostQueryHook implements WorkspacePostQueryHookInstance {
  constructor(private readonly claimService: OpportunityClaimService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: unknown,
  ): Promise<void> {
    for (const ref of extractRowRefs(payload)) {
      await this.claimService.syncStickyAssignment(authContext, ref.id);
    }
  }
}
