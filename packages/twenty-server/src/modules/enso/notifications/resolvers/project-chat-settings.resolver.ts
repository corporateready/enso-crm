import { UseFilters, UseGuards, UsePipes } from '@nestjs/common';

import { Args, Mutation, Query } from '@nestjs/graphql';
import { IsNull } from 'typeorm';
import { PermissionFlagType } from 'twenty-shared/constants';
import { isDefined } from 'twenty-shared/utils';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { AuthGraphqlApiExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-graphql-api-exception.filter';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { GoogleChatTestResult } from 'src/modules/enso/notifications/dtos/google-chat-test-result.dto';
import { ProjectChatWebhookSettings } from 'src/modules/enso/notifications/dtos/project-chat-webhook-settings.dto';
import { SetProjectChatWebhookUrlInput } from 'src/modules/enso/notifications/dtos/set-project-chat-webhook-url.input';
import { ProjectChatWebhookService } from 'src/modules/enso/notifications/services/project-chat-webhook.service';

// A PROJECT's marketing space is shared infrastructure, not a personal setting:
// one URL decides where every lead for that development gets announced. So
// unlike NotificationSettingsResolver (any signed-in member manages their own
// private webhook), these are gated on the same permission that governs API
// keys and webhooks.
@MetadataResolver()
@UsePipes(ResolverValidationPipe)
@UseFilters(AuthGraphqlApiExceptionFilter)
@UseGuards(WorkspaceAuthGuard)
export class ProjectChatSettingsResolver {
  constructor(
    private readonly projectChatWebhookService: ProjectChatWebhookService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  // Every project, each with its current configuration state — so the UI can
  // render the full list rather than making the admin remember which
  // developments exist.
  @Query(() => [ProjectChatWebhookSettings])
  @UseGuards(SettingsPermissionGuard(PermissionFlagType.API_KEYS_AND_WEBHOOKS))
  async projectChatWebhookSettings(
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<ProjectChatWebhookSettings[]> {
    const projects = await this.loadProjects(workspace.id);

    return Promise.all(
      projects.map(async (project) => {
        const maskedWebhookUrl =
          await this.projectChatWebhookService.getMaskedWebhookUrl({
            projectId: project.id,
            workspaceId: workspace.id,
          });

        return {
          projectId: project.id,
          projectName: project.name,
          projectCode: project.code,
          isConfigured: isDefined(maskedWebhookUrl),
          maskedWebhookUrl,
        };
      }),
    );
  }

  @Mutation(() => ProjectChatWebhookSettings)
  @UseGuards(SettingsPermissionGuard(PermissionFlagType.API_KEYS_AND_WEBHOOKS))
  async setProjectChatWebhookUrl(
    @Args('input') input: SetProjectChatWebhookUrlInput,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<ProjectChatWebhookSettings> {
    await this.projectChatWebhookService.setWebhookUrl({
      projectId: input.projectId,
      workspaceId: workspace.id,
      webhookUrl: input.webhookUrl,
    });

    const maskedWebhookUrl =
      await this.projectChatWebhookService.getMaskedWebhookUrl({
        projectId: input.projectId,
        workspaceId: workspace.id,
      });

    const project = (await this.loadProjects(workspace.id)).find(
      (candidate) => candidate.id === input.projectId,
    );

    return {
      projectId: input.projectId,
      projectName: project?.name,
      projectCode: project?.code,
      isConfigured: true,
      maskedWebhookUrl,
    };
  }

  @Mutation(() => Boolean)
  @UseGuards(SettingsPermissionGuard(PermissionFlagType.API_KEYS_AND_WEBHOOKS))
  async deleteProjectChatWebhookUrl(
    @Args('projectId', { type: () => String }) projectId: string,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<boolean> {
    await this.projectChatWebhookService.deleteWebhookUrl({
      projectId,
      workspaceId: workspace.id,
    });

    return true;
  }

  @Mutation(() => GoogleChatTestResult)
  @UseGuards(SettingsPermissionGuard(PermissionFlagType.API_KEYS_AND_WEBHOOKS))
  async sendProjectChatTestNotification(
    @Args('projectId', { type: () => String }) projectId: string,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<GoogleChatTestResult> {
    const webhookUrl = await this.projectChatWebhookService.getWebhookUrl({
      projectId,
      workspaceId: workspace.id,
    });

    if (!isDefined(webhookUrl)) {
      return {
        success: false,
        error: 'No Google Chat webhook is configured for this project yet.',
      };
    }

    const project = (await this.loadProjects(workspace.id)).find(
      (candidate) => candidate.id === projectId,
    );

    const success = await this.projectChatWebhookService.post(webhookUrl, {
      text:
        `✅ ENSO CRM is connected to this space. New ${project?.name ?? 'project'} ` +
        `deals will be posted here with their attribution.`,
    });

    return success
      ? { success: true }
      : { success: false, error: 'Google Chat rejected the test message.' };
  }

  private async loadProjects(
    workspaceId: string,
  ): Promise<Array<{ id: string; name?: string; code?: string }>> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const projectRepository =
          await this.globalWorkspaceOrmManager.getRepository<any>(
            workspaceId,
            'project',
            { shouldBypassPermissionChecks: true },
          );

        // IsNull(), not `deletedAt: null` — a bare null compares with `= NULL`
        // and would silently return no projects at all.
        const projects = await projectRepository.find({
          where: { deletedAt: IsNull() },
        });

        return projects.map((project: any) => ({
          id: project.id,
          name: project.name ?? undefined,
          code: project.code ?? undefined,
        }));
      },
      buildSystemAuthContext(workspaceId),
    );
  }
}
