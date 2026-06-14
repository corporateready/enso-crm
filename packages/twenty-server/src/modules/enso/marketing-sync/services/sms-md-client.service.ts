import { Injectable, Logger } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';

import { SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';

// Thin client over the sms.md REST API (Moldovan SMS gateway). sms.md is NOT a
// native Dittofeed provider, so an SMS journey step is a Webhook-channel node →
// the CRM /webhooks/enso/send-sms relay → this client. Routing through the CRM
// keeps the API key in CRM env (not in a Dittofeed template) and sends auditable.
//
// Authoritative contract (partner.sms.md/api/doc Swagger, verified 2026-06-14):
//   GET {base}/v1/send?token=<key>&from=<alias>&to=<E.164>&message=<text>[&time=]
//   Auth = apiKey `token` in the QUERY (security scheme), 201 {"message":"Added to queue"}.
// Config from process.env: SMS_MD_API_URL (default https://api.sms.md/v1/send),
// SMS_MD_API_KEY, SMS_MD_SENDER (default ARTIMA — operator-approved alias).
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
    // The operator-approved alias on the account is "ARTIMA" (not "ARTIMA.MD" —
    // see partner.sms.md → Senders). Override per deployment via SMS_MD_SENDER.
    return process.env.SMS_MD_SENDER || 'ARTIMA';
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

    // Auth is an apiKey named `token` in the QUERY (per partner.sms.md/api/doc),
    // NOT an Authorization: Bearer header. Pass token + the recipient via axios
    // `params` (not the URL string) so the secure client's request logger only
    // records the base URL — keeping the API key and the phone number out of logs.
    try {
      await client.get(this.baseUrl, {
        params: {
          token: this.apiKey,
          from: this.sender,
          to: params.to,
          message: params.message,
        },
      });
    } catch (error) {
      // Never let the raw axios error bubble: it holds a circular https-agent
      // reference that crashes NestJS response serialization (→ opaque 500).
      const axiosError = error as {
        response?: { status?: number; data?: unknown };
      };
      const status = axiosError?.response?.status;
      const data = axiosError?.response?.data;

      this.logger.warn(
        `sms.md send failed (status ${status ?? 'unknown'}): ${
          typeof data === 'string' ? data : JSON.stringify(data ?? {})
        }`,
      );

      throw new Error(`sms.md send failed with status ${status ?? 'unknown'}`);
    }
  }
}
