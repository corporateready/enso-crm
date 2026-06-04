import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common';

import { PermissionFlagType } from 'twenty-shared/constants';

import { RestApiExceptionFilter } from 'src/engine/api/rest/rest-api-exception.filter';
import { type UserEntity } from 'src/engine/core-modules/user/user.entity';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthUser } from 'src/engine/decorators/auth/auth-user.decorator';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { JwtAuthGuard } from 'src/engine/guards/jwt-auth.guard';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { ChatwootReplyInput } from 'src/modules/enso/chatwoot/dtos/chatwoot-reply.input';
import { ChatwootAgentProvisioningService } from 'src/modules/enso/chatwoot/services/chatwoot-agent-provisioning.service';
import { ChatwootMessagingService } from 'src/modules/enso/chatwoot/services/chatwoot-messaging.service';

// Server side of the native in-CRM chat panel (Phase 5). All endpoints require a
// real logged-in user (JWT + workspace) and only ever touch conversations that
// belong to the given opportunity. Chatwoot's API is proxied with the account
// token server-side — the token never reaches the browser.
@Controller('rest/enso/chatwoot')
@UseGuards(JwtAuthGuard, WorkspaceAuthGuard)
@UseFilters(RestApiExceptionFilter)
export class ChatwootController {
  constructor(
    private readonly messagingService: ChatwootMessagingService,
    private readonly provisioningService: ChatwootAgentProvisioningService,
  ) {}

  // The deal's conversations (newest activity first) for the panel's list.
  @Get('conversations')
  @UseGuards(NoPermissionGuard)
  async conversations(
    @Query('opportunityId') opportunityId: string,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ) {
    const conversations = await this.messagingService.listConversations(
      workspace.id,
      opportunityId,
    );

    return { conversations };
  }

  // Messages for one conversation on the deal (oldest → newest). Polled by the
  // panel for near-real-time updates.
  @Get('messages')
  @UseGuards(NoPermissionGuard)
  async messages(
    @Query('opportunityId') opportunityId: string,
    @Query('conversationId') conversationId: string,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ) {
    const messages = await this.messagingService.listMessages(
      workspace.id,
      opportunityId,
      conversationId,
    );

    return { messages };
  }

  // Send a reply (attributed to the calling manager when possible).
  @Post('reply')
  @UseGuards(NoPermissionGuard)
  async reply(
    @Body() body: ChatwootReplyInput,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUser() user: UserEntity,
  ) {
    const message = await this.messagingService.sendReply({
      workspaceId: workspace.id,
      opportunityId: body.opportunityId,
      conversationId: body.conversationId,
      content: body.content,
      userEmail: user.email,
      userName: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
    });

    return { message };
  }

  // Admin: bulk-provision Chatwoot agents for all routing-eligible members.
  @Post('provision-agents')
  @UseGuards(SettingsPermissionGuard(PermissionFlagType.WORKSPACE_MEMBERS))
  async provisionAgents(@AuthWorkspace() workspace: WorkspaceEntity) {
    const results = await this.provisioningService.provisionRoutingMembers(
      workspace.id,
    );

    return { results };
  }
}
