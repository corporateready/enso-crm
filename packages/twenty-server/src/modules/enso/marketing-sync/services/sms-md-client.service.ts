import { Injectable, Logger } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';

import { SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';

// Thin client over the sms.md REST API (Moldovan SMS gateway). sms.md is NOT a
// native Dittofeed provider, so an SMS journey step is a Webhook-channel node →
// the CRM /webhooks/enso/send-sms relay → this client. Routing through the CRM
// keeps the API key in CRM env (not in a Dittofeed template) and sends auditable.
//
// Authoritative contract (partner.sms.md/api/doc, verified 2026-06-14):
//   GET {base}/v1/send?from=<alias>&to=<E.164>&message=<text>[&time=<delay>]
//   Authorization: Bearer <SMS_MD_API_KEY>; 201 {"message":"Added to queue"}.
// Config from process.env: SMS_MD_API_URL (default https://api.sms.md/v1/send),
// SMS_MD_API_KEY, SMS_MD_SENDER (default ARTIMA.MD — operator-approved alias).
// When unconfigured the call no-ops so a missing key never breaks the worker.

type SendSmsParams = {
  to: string;
  message: string;
};

@Injectable()
export class SmsMdClientService {
  private readonly logger = new Logger(SmsMdClientService.name);

  constructor(
    private readonly secureHttpClientService: SecureHttpClientService,
  ) {}

  private get baseUrl(): string {
    return (
      process.env.SMS_MD_API_URL?.replace(/\/$/, '') ||
      'https://api.sms.md/v1/send'
    );
  }

  private get apiKey(): string | undefined {
    return process.env.SMS_MD_API_KEY || undefined;
  }

  private get sender(): string {
    return process.env.SMS_MD_SENDER || 'ARTIMA.MD';
  }

  get isConfigured(): boolean {
    return isNonEmptyString(this.apiKey);
  }

  async send(workspaceId: string, params: SendSmsParams): Promise<void> {
    if (!this.isConfigured) {
      this.logger.warn('sms.md not configured (SMS_MD_API_KEY); skipping send');

      return;
    }

    const client = this.secureHttpClientService.getHttpClient(
      { timeout: 10_000, retries: 2 },
      { workspaceId, source: 'sms-md' },
    );

    const url =
      `${this.baseUrl}?from=${encodeURIComponent(this.sender)}` +
      `&to=${encodeURIComponent(params.to)}` +
      `&message=${encodeURIComponent(params.message)}`;

    // Throws on failure so the caller (or BullMQ) can react; sms.md returns 201
    // {"message":"Added to queue"} on success.
    await client.get(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
  }
}
