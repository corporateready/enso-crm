import { type MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { isCompanyAutomationEnabled } from 'src/modules/enso/company-enrichment/company-enrichment.constants';
import { ResolveCompanyFromPersonJob } from 'src/modules/enso/company-enrichment/jobs/resolve-company-from-person.job';
import { type ResolveCompanyFromPersonJobData } from 'src/modules/enso/company-enrichment/jobs/company-enrichment-job.types';
import { extractRowRefs } from 'src/modules/enso/person-relationship/query-hooks/extract-row-refs.util';

// Shared body for the person.* POST hooks: normalize the payload to row refs and
// enqueue one company-resolution job per person. Thin by design — the work runs
// in the worker. Gated by the master kill-switch so the feature ships dormant.
export const enqueueCompanyResolution = async (
  messageQueueService: MessageQueueService,
  workspaceId: string,
  payload: unknown,
): Promise<void> => {
  if (!isCompanyAutomationEnabled()) {
    return;
  }

  for (const ref of extractRowRefs(payload)) {
    await messageQueueService.add<ResolveCompanyFromPersonJobData>(
      ResolveCompanyFromPersonJob.name,
      { workspaceId, personId: ref.id },
    );
  }
};
