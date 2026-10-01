import { Module } from '@nestjs/common';

import { DEAL_COMMENT_WRITE_GUARDS } from 'src/modules/enso/deal-comment/query-hooks/deal-comment-write-guard.pre-query-hook';

@Module({
  providers: [...DEAL_COMMENT_WRITE_GUARDS],
})
export class DealCommentQueryHookModule {}
