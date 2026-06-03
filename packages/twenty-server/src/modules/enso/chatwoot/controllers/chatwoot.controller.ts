import { Body, Controller, Post, UseFilters, UseGuards } from '@nestjs/common';

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
import { ChatwootSsoInput } from 'src/modules/enso/chatwoot/dtos/chatwoot-sso.input';
import { ChatwootAgentProvisioningService } from 'src/modules/enso/chatwoot/services/chatwoot-agent-provisioning.service';
import { ChatwootSsoService } from 'src/modules/enso/chatwoot/services/chatwoot-sso.service';

// Server side of the embedded Chatwoot conversation (Phase 5). All endpoints
// require a real logged-in user (JWT + workspace) — an API key alone is
// rejected by @AuthUser, which is correct: SSO is minted FOR the calling
// manager.
@Controller('rest/enso/chatwoot')
@UseGuards(JwtAuthGuard, WorkspaceAuthGuard)
@UseFilters(RestApiExceptionFilter)
export class ChatwootController {
  constructor(
    private readonly chatwootSsoService: ChatwootSsoService,
    private readonly provisioningService: ChatwootAgentProvisioningService,
  ) {}

  // Mint a fresh embedded-conversation session for the current manager on a
  // given deal. `{ available: false }` means the deal has no Chatwoot
  // conversation to show (render an empty state, not an error).
  @Post('sso')
  @UseGuards(NoPermissionGuard)
  async mintSso(
    @Body() body: ChatwootSsoInput,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUser() user: UserEntity,
  ) {
    const result = await this.chatwootSsoService.mintForOpportunity({
      workspaceId: workspace.id,
      opportunityId: body.opportunityId,
      userEmail: user.email,
      userName: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
    });

    if (!result) {
      return { available: false };
    }

    return {
      available: true,
      ssoUrl: result.ssoUrl,
      conversationUrl: result.conversationUrl,
      conversationId: result.conversationId,
    };
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
