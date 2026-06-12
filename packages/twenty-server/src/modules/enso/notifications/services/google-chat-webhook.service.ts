import { Injectable, Logger } from '@nestjs/common';

import axios from 'axios';
import { isDefined } from 'twenty-shared/utils';

import { KeyValuePairType } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { KeyValuePairService } from 'src/engine/core-modules/key-value-pair/key-value-pair.service';
import { SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import {
  GOOGLE_CHAT_WEBHOOK_HOST,
  GOOGLE_CHAT_WEBHOOK_URL_KEY,
  GOOGLE_CHAT_WEBHOOK_URL_MASK,
  NOTIFICATION_PREFERENCES_KEY,
  type NotificationEventKey,
} from 'src/modules/enso/notifications/notifications.constants';

type UserWorkspaceScope = { userId: string; workspaceId: string };

// Stores + reads each manager's personal Google Chat incoming-webhook URL
// (encrypted, in the core keyValuePair table) and posts messages to it. Shared
// by the settings resolver (read/write/test) and the lead-pipeline worker
// (per-manager routing notifications), so per-manager delivery has one home.
@Injectable()
export class GoogleChatWebhookService {
  private readonly logger = new Logger(GoogleChatWebhookService.name);

  constructor(
    private readonly keyValuePairService: KeyValuePairService,
    private readonly secretEncryptionService: SecretEncryptionService,
  ) {}

  // Throws if the URL isn't a Google Chat incoming webhook. Callers surface the
  // message to the user (settings) — keep it human-readable.
  assertValidWebhookUrl(webhookUrl: string): void {
    let parsed: URL;

    try {
      parsed = new URL(webhookUrl);
    } catch {
      throw new Error('That is not a valid URL.');
    }

    if (
      parsed.protocol !== 'https:' ||
      parsed.host !== GOOGLE_CHAT_WEBHOOK_HOST
    ) {
      throw new Error(
        `That is not a Google Chat webhook. It must start with https://${GOOGLE_CHAT_WEBHOOK_HOST}/`,
      );
    }
  }

  async getWebhookUrl({
    userId,
    workspaceId,
  }: UserWorkspaceScope): Promise<string | undefined> {
    const stored = await this.getStoredValue({ userId, workspaceId });

    if (!isDefined(stored)) {
      return undefined;
    }

    try {
      return this.secretEncryptionService.decryptVersioned(stored, {
        workspaceId,
      });
    } catch (error) {
      this.logger.error(
        `Failed to decrypt Google Chat webhook URL: ${(error as Error).message}`,
      );

      return undefined;
    }
  }

  async getMaskedWebhookUrl({
    userId,
    workspaceId,
  }: UserWorkspaceScope): Promise<string | undefined> {
    const stored = await this.getStoredValue({ userId, workspaceId });

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
    userId,
    workspaceId,
    webhookUrl,
  }: UserWorkspaceScope & { webhookUrl: string }): Promise<void> {
    this.assertValidWebhookUrl(webhookUrl);

    const encrypted = this.secretEncryptionService.encryptVersioned(
      webhookUrl.trim(),
      { workspaceId },
    );

    await this.keyValuePairService.set({
      userId,
      workspaceId,
      key: GOOGLE_CHAT_WEBHOOK_URL_KEY,
      value: encrypted,
      type: KeyValuePairType.USER_VARIABLE,
    });
  }

  async deleteWebhookUrl({
    userId,
    workspaceId,
  }: UserWorkspaceScope): Promise<void> {
    await this.keyValuePairService.delete({
      userId,
      workspaceId,
      key: GOOGLE_CHAT_WEBHOOK_URL_KEY,
      type: KeyValuePairType.USER_VARIABLE,
    });
  }

  // Best-effort POST — a missing/failed webhook must never break the caller
  // (routing, hooks). Returns whether the post succeeded so the test button can
  // report it. Accepts either a `{ text }` or a `{ cardsV2 }` payload.
  async post(
    webhookUrl: string,
    message: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      await axios.post(webhookUrl, message, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10_000,
      });

      return true;
    } catch (error) {
      this.logger.error(
        `Google Chat notification failed: ${(error as Error).message}`,
      );

      return false;
    }
  }

  // Per-event toggles (JSON map in keyValuePair). Opt-OUT: a missing key = ON.
  async getPreferences({
    userId,
    workspaceId,
  }: UserWorkspaceScope): Promise<Record<string, boolean>> {
    const rows = await this.keyValuePairService.get({
      type: KeyValuePairType.USER_VARIABLE,
      userId,
      workspaceId,
      key: NOTIFICATION_PREFERENCES_KEY,
    });

    const raw = rows?.[0]?.value;

    return isDefined(raw) && typeof raw === 'object'
      ? (raw as Record<string, boolean>)
      : {};
  }

  async setPreference({
    userId,
    workspaceId,
    event,
    enabled,
  }: UserWorkspaceScope & {
    event: NotificationEventKey;
    enabled: boolean;
  }): Promise<Record<string, boolean>> {
    const preferences = await this.getPreferences({ userId, workspaceId });
    const next = { ...preferences, [event]: enabled };

    await this.keyValuePairService.set({
      userId,
      workspaceId,
      key: NOTIFICATION_PREFERENCES_KEY,
      value: next,
      type: KeyValuePairType.USER_VARIABLE,
    });

    return next;
  }

  // Default ON — only false when the manager has explicitly muted the event.
  async shouldNotify({
    userId,
    workspaceId,
    event,
  }: {
    userId: string | undefined;
    workspaceId: string;
    event: NotificationEventKey;
  }): Promise<boolean> {
    if (!isDefined(userId)) {
      return true;
    }

    const preferences = await this.getPreferences({ userId, workspaceId });

    return preferences[event] !== false;
  }

  private async getStoredValue({
    userId,
    workspaceId,
  }: UserWorkspaceScope): Promise<string | undefined> {
    const rows = await this.keyValuePairService.get({
      type: KeyValuePairType.USER_VARIABLE,
      userId,
      workspaceId,
      key: GOOGLE_CHAT_WEBHOOK_URL_KEY,
    });

    const stored = rows?.[0]?.value;

    return typeof stored === 'string' ? stored : undefined;
  }
}
