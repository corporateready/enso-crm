import { Module } from '@nestjs/common';

import { DEAL_COMMENT_WRITE_GUARDS } from 'src/modules/enso/deal-comment/query-hooks/deal-comment-write-guard.pre-query-hook';
import { MENTION_ONLY_WRITE_HOOKS } from 'src/modules/enso/deal-comment/query-hooks/mention-only-write.pre-query-hook';
import { MentionOnlyAccessService } from 'src/modules/enso/deal-comment/services/mention-only-access.service';
import { EnsoViewerScopeModule } from 'src/modules/enso/record-visibility/enso-viewer-scope.module';

@Module({
  imports: [EnsoViewerScopeModule],
  providers: [
    MentionOnlyAccessService,
    ...DEAL_COMMENT_WRITE_GUARDS,
    ...MENTION_ONLY_WRITE_HOOKS,
  ],
})
export class DealCommentQueryHookModule {}
