import { Module } from '@nestjs/common';

import { ChatwootAgentProvisioningService } from 'src/modules/enso/chatwoot/services/chatwoot-agent-provisioning.service';
import { ChatwootAssignmentService } from 'src/modules/enso/chatwoot/services/chatwoot-assignment.service';
import { ChatwootClientService } from 'src/modules/enso/chatwoot/services/chatwoot-client.service';
import { ChatwootConversationResolverService } from 'src/modules/enso/chatwoot/services/chatwoot-conversation-resolver.service';
import { ChatwootMessagingService } from 'src/modules/enso/chatwoot/services/chatwoot-messaging.service';
import { ChatwootReplyLogService } from 'src/modules/enso/chatwoot/services/chatwoot-reply-log.service';

// Phase 5 — the Chatwoot integration, SERVICES ONLY (no controller). Lean on
// purpose: imported by LeadPipelineModule (the on-claim hook uses
// ChatwootAssignmentService) inside the query-hook graph, so it must not drag in
// auth/permission modules. The REST controller + its guard dependencies live in
// ChatwootApiModule (HTTP graph) instead.
@Module({
  providers: [
    ChatwootClientService,
    ChatwootConversationResolverService,
    ChatwootAssignmentService,
    ChatwootAgentProvisioningService,
    ChatwootMessagingService,
    ChatwootReplyLogService,
  ],
  exports: [
    ChatwootClientService,
    ChatwootAssignmentService,
    ChatwootAgentProvisioningService,
    ChatwootMessagingService,
  ],
})
export class ChatwootModule {}
