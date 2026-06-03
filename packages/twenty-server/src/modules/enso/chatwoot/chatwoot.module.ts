import { Module } from '@nestjs/common';

import { ChatwootController } from 'src/modules/enso/chatwoot/controllers/chatwoot.controller';
import { ChatwootAgentProvisioningService } from 'src/modules/enso/chatwoot/services/chatwoot-agent-provisioning.service';
import { ChatwootAssignmentService } from 'src/modules/enso/chatwoot/services/chatwoot-assignment.service';
import { ChatwootClientService } from 'src/modules/enso/chatwoot/services/chatwoot-client.service';
import { ChatwootSsoService } from 'src/modules/enso/chatwoot/services/chatwoot-sso.service';

// Phase 5 — the embedded Chatwoot conversation. Hosts the SSO/provisioning REST
// controller (imported by ModulesModule → mounted on the API server) and
// exports the assignment-push service used by the lead-pipeline claim hook.
@Module({
  providers: [
    ChatwootClientService,
    ChatwootAssignmentService,
    ChatwootAgentProvisioningService,
    ChatwootSsoService,
  ],
  controllers: [ChatwootController],
  exports: [ChatwootClientService, ChatwootAssignmentService],
})
export class ChatwootModule {}
