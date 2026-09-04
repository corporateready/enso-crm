import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { KeyValuePairType } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { KeyValuePairService } from 'src/engine/core-modules/key-value-pair/key-value-pair.service';
import { SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import {
  GOOGLE_CHAT_WEBHOOK_URL_MASK,
  projectChatWebhookKey,
} from 'src/modules/enso/notifications/notifications.constants';
import { GoogleChatWebhookService } from 'src/modules/enso/notifications/services/google-chat-webhook.service';

type ProjectScope = { projectId: string; workspaceId: string };

// Stores + reads the Google Chat incoming-webhook URL of each PROJECT's shared
// marketing space (encrypted, in the core keyValuePair table).
//
// Scoped to the WORKSPACE (userId = null), not to a user: a project room belongs
// to the development, so whoever configures it, everyone's leads land there.
// That is the whole difference from GoogleChatWebhookService, whose rows are
// per-manager — URL validation and posting are reused from it rather than
// re-implemented, so there is exactly one place that decides what a valid
// Google Chat webhook is.
@Injectable()
export class ProjectChatWebhookService {
  private readonly logger = new Logger(ProjectChatWebhookService.name);

  constructor(
    private readonly keyValuePairService: KeyValuePairService,
    private readonly secretEncryptionService: SecretEncryptionService,
    private readonly googleChatWebhookService: GoogleChatWebhookService,
  ) {}

  async getWebhookUrl({
    projectId,
    workspaceId,
  }: ProjectScope): Promise<string | undefined> {
    const stored = await this.getStoredValue({ projectId, workspaceId });

    if (!isDefined(stored)) {
      return undefined;
    }

    try {
      return this.secretEncryptionService.decryptVersioned(stored, {
        workspaceId,
      });
    } catch (error) {
      this.logger.error(
        `Failed to decrypt project ${projectId} chat webhook URL: ${(error as Error).message}`,
      );

      return undefined;
    }
  }

  async getMaskedWebhookUrl({
    projectId,
    workspaceId,
  }: ProjectScope): Promise<string | undefined> {
    const stored = await this.getStoredValue({ projectId, workspaceId });

    if (!isDefined(stored)) {
      return undefined;
    }

    try {
      return this.secretEncryptionService.decryptAndMaskVersioned({
        value: stored,
        mask: GOOGLE_CHAT_WEBHOOK_URL_MASK,
        workspaceId,
      });
    } catch {
      return GOOGLE_CHAT_WEBHOOK_URL_MASK;
    }
  }

  async setWebhookUrl({
    projectId,
    workspaceId,
    webhookUrl,
  }: ProjectScope & { webhookUrl: string }): Promise<void> {
    this.googleChatWebhookService.assertValidWebhookUrl(webhookUrl);

    const encrypted = this.secretEncryptionService.encryptVersioned(
      webhookUrl.trim(),
      { workspaceId },
    );

    await this.keyValuePairService.set({
      userId: null,
      workspaceId,
      key: projectChatWebhookKey(projectId),
      value: encrypted,
      type: KeyValuePairType.USER_VARIABLE,
    });
  }

  async deleteWebhookUrl({
    projectId,
    workspaceId,
  }: ProjectScope): Promise<void> {
    await this.keyValuePairService.delete({
      userId: null,
      workspaceId,
      key: projectChatWebhookKey(projectId),
      type: KeyValuePairType.USER_VARIABLE,
    });
  }

  // Best-effort, same contract as the per-manager poster: an unconfigured or
  // failing project room must never break the pipeline that opened the deal.
  async post(
    webhookUrl: string,
    message: Record<string, unknown>,
  ): Promise<boolean> {
    return this.googleChatWebhookService.post(webhookUrl, message);
  }

  private async getStoredValue({
    projectId,
    workspaceId,
  }: ProjectScope): Promise<string | undefined> {
    const rows = await this.keyValuePairService.get({
      type: KeyValuePairType.USER_VARIABLE,
      userId: null,
      workspaceId,
      key: projectChatWebhookKey(projectId),
    });

    const stored = rows?.[0]?.value;

    return typeof stored === 'string' ? stored : undefined;
  }
}
