import { Module } from '@nestjs/common';

import { DealCommentResolver } from 'src/modules/enso/deal-comment/resolvers/deal-comment.resolver';
import { DealCommentService } from 'src/modules/enso/deal-comment/services/deal-comment.service';
import { EnsoViewerScopeModule } from 'src/modules/enso/record-visibility/enso-viewer-scope.module';

// Imported by CoreEngineModule, not ModulesModule: a @MetadataResolver only
// reaches the metadata GraphQL schema from the CoreEngineModule graph, and a
// resolver in the wrong graph fails silently. See TelephonyOutboundModule.
@Module({
  imports: [EnsoViewerScopeModule],
  providers: [DealCommentResolver, DealCommentService],
  exports: [DealCommentService],
})
export class DealCommentModule {}
