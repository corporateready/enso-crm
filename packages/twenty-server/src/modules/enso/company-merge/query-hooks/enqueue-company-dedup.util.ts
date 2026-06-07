import { type MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { FindCompanyDuplicatesJob } from 'src/modules/enso/company-merge/jobs/find-company-duplicates.job';
import { type FindCompanyDuplicatesJobData } from 'src/modules/enso/company-merge/jobs/company-merge-job.types';
import { extractRowRefs } from 'src/modules/enso/person-relationship/query-hooks/extract-row-refs.util';

// Shared body for the company.* POST hooks: normalize the payload to row refs and
// enqueue one duplicate-check job per company. Catches companies written through
// the GraphQL API (manual UI edits, native Twenty contact-creation, n8n direct
// writes). Companies created/enriched by our own enso services use repository
// writes that bypass these hooks, so those paths enqueue the find job directly.
export const enqueueCompanyDedup = async (
  messageQueueService: MessageQueueService,
  workspaceId: string,
  payload: unknown,
): Promise<void> => {
  for (const ref of extractRowRefs(payload)) {
    await messageQueueService.add<FindCompanyDuplicatesJobData>(
      FindCompanyDuplicatesJob.name,
      { workspaceId, companyId: ref.id },
    );
  }
};
