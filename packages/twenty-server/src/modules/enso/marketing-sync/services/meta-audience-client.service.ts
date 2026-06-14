import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';

import { SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';

// Client over the Meta (Facebook) Marketing API for Custom Audience membership.
// Meta has no native Dittofeed node, so the audience step is a Webhook-channel
// node → CRM /webhooks/enso/meta-audience relay → this client (key stays in CRM
// env). Identifiers are SHA-256 hashed AFTER normalization, per Meta's rules, so
// raw email/phone never leave the CRM.
//
// Config (process.env): META_ACCESS_TOKEN (ads_management — USER sets it),
// META_AD_ACCOUNT_ID (digits, no act_ prefix), META_CUSTOM_AUDIENCE_ID,
// META_GRAPH_VERSION (default v21.0), META_GRAPH_URL (default graph.facebook.com).
// Unconfigured → no-ops so a missing token never breaks the worker.

@Injectable()
export class MetaAudienceClientService {
  private readonly logger = new Logger(MetaAudienceClientService.name);

  constructor(
    private readonly secureHttpClientService: SecureHttpClientService,
  ) {}

  private get baseUrl(): string {
    const host =
      process.env.META_GRAPH_URL?.replace(/\/$/, '') ||
      'https://graph.facebook.com';
    const version = process.env.META_GRAPH_VERSION || 'v21.0';

    return `${host}/${version}`;
  }

  private get accessToken(): string | undefined {
    return process.env.META_ACCESS_TOKEN || undefined;
  }

  private get adAccountId(): string | undefined {
    return process.env.META_AD_ACCOUNT_ID || undefined;
  }

  private get customAudienceId(): string | undefined {
    return process.env.META_CUSTOM_AUDIENCE_ID || undefined;
  }

  get isConfigured(): boolean {
    return (
      isNonEmptyString(this.accessToken) &&
      isNonEmptyString(this.customAudienceId)
    );
  }

  // Meta normalization: email → trim + lowercase; phone → digits only (keeps the
  // country code, drops +/spaces/leading zeros handled by the caller's E.164).
  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private normalizedHashes(
    email: string | undefined,
    phone: string | undefined,
  ): { emailHash: string; phoneHash: string } | null {
    const normalizedEmail = isNonEmptyString(email)
      ? email.trim().toLowerCase()
      : '';
    const normalizedPhone = isNonEmptyString(phone)
      ? phone.replace(/\D/g, '')
      : '';

    if (!normalizedEmail && !normalizedPhone) {
      return null;
    }

    return {
      emailHash: normalizedEmail ? this.hash(normalizedEmail) : '',
      phoneHash: normalizedPhone ? this.hash(normalizedPhone) : '',
    };
  }

  // Add one person to the Custom Audience. POST /{audience-id}/users with the
  // hashed payload. Throws (clean message) on failure so the caller can react.
  async addUser(
    workspaceId: string,
    identifiers: { email?: string; phone?: string },
  ): Promise<void> {
    if (!this.isConfigured) {
      this.logger.warn(
        'Meta not configured (META_ACCESS_TOKEN / META_CUSTOM_AUDIENCE_ID); skipping',
      );

      return;
    }

    const hashes = this.normalizedHashes(identifiers.email, identifiers.phone);

    if (!hashes) {
      this.logger.warn('Meta audience add skipped: no email or phone');

      return;
    }

    const client = this.secureHttpClientService.getHttpClient(
      { timeout: 10_000, retries: 2 },
      { workspaceId, source: 'meta-graph' },
    );

    const url = `${this.baseUrl}/${this.customAudienceId}/users`;

    try {
      await client.post(
        url,
        {
          payload: {
            schema: ['EMAIL', 'PHONE'],
            data: [[hashes.emailHash, hashes.phoneHash]],
          },
        },
        { params: { access_token: this.accessToken } },
      );
    } catch (error) {
      const metaError = error as {
        response?: { status?: number; data?: unknown };
      };

      this.logger.warn(
        `Meta audience add failed (status ${
          metaError?.response?.status ?? 'unknown'
        }): ${JSON.stringify(metaError?.response?.data ?? {})}`,
      );

      throw new Error(
        `Meta audience add failed with status ${
          metaError?.response?.status ?? 'unknown'
        }`,
      );
    }
  }

  // One-time: create the "customer file" Custom Audience and return its id (to
  // be saved as META_CUSTOM_AUDIENCE_ID). Needs the ad account + token.
  async createAudience(workspaceId: string, name: string): Promise<string> {
    if (
      !isNonEmptyString(this.accessToken) ||
      !isNonEmptyString(this.adAccountId)
    ) {
      throw new Error('META_ACCESS_TOKEN / META_AD_ACCOUNT_ID not configured');
    }

    const client = this.secureHttpClientService.getHttpClient(
      { timeout: 10_000, retries: 1 },
      { workspaceId, source: 'meta-graph' },
    );

    const response = await client.post(
      `${this.baseUrl}/act_${this.adAccountId}/customaudiences`,
      {
        name,
        subscription_type: 'CUSTOMER_FILE',
        customer_file_source: 'USER_PROVIDED_ONLY',
      },
      { params: { access_token: this.accessToken } },
    );

    return response.data?.id as string;
  }
}
