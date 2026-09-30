import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';

import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';
import { ChatwootNewMessageService } from 'src/modules/enso/chatwoot/services/chatwoot-new-message.service';

// Public receiver for Chatwoot's account webhook (message_created). Lives outside
// /rest/* like the other enso webhooks, because the authenticated REST catch-all
// owns that namespace. There is no shared secret: the payload is only a hint and
// the service re-reads the message from Chatwoot before acting on it.
// Reachable at POST /webhooks/enso/chatwoot-events.
@Controller()
export class ChatwootWebhookController {
  constructor(private readonly newMessageService: ChatwootNewMessageService) {}

  @Post('webhooks/enso/chatwoot-events')
  @HttpCode(200)
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async events(@Body() body: Record<string, unknown>): Promise<{ ok: true }> {
    // Answer immediately: Chatwoot's webhook call times out after a few seconds,
    // and the notification needs a Chatwoot round-trip plus a Google Chat post.
    void this.newMessageService.handleMessageCreated(
      body as Parameters<ChatwootNewMessageService['handleMessageCreated']>[0],
    );

    return { ok: true };
  }
}
