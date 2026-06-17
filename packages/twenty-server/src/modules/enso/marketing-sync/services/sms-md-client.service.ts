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
  // Operator-approved sender alias to send as; defaults to SMS_MD_SENDER (ARTIMA).
  from?: string;
};

// Normalised delivery state we persist on the outboundActivity. sms.md is
// poll-based (no push DLR); QUEUED/SENT are in-transit, DELIVERED/FAILED final.
export type SmsDeliveryStatus =
  | 'QUEUED'
  | 'SENT'
  | 'DELIVERED'
  | 'FAILED'
  | 'UNKNOWN';

// sms.md status dictionary (GET /v1/message/status, verified 2026-06-16):
//   1 Ждет отправки (waiting)·2 Отправлено (sent)·3 Доставлено (delivered)
//   4 Повторная отправка (retrying)·5 У оператора (queued at operator)
//   9 Ошибка отправки (send error). Final = 3 (delivered) / 9 (failed).
export const mapSmsMdStatusId = (statusId: number): SmsDeliveryStatus => {
  switch (statusId) {
    case 1:
      return 'QUEUED';
    case 2:
    case 4:
    case 5:
      return 'SENT';
    case 3:
      return 'DELIVERED';
    case 9:
      return 'FAILED';
    default:
      return 'UNKNOWN';
  }
};

export const isFinalSmsDeliveryStatus = (status: SmsDeliveryStatus): boolean =>
  status === 'DELIVERED' || status === 'FAILED';

type SmsMdMessage = {
  id: string;
  to: string;
  message: string;
  status: string;
  dateCreated: string;
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

  // The message-status API lives next to /send (…/v1/message). Derive it from
  // the send base so a custom SMS_MD_API_URL keeps both in sync.
  private get messageBaseUrl(): string {
    return this.baseUrl.replace(/\/send$/, '/message');
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
          from: params.from || this.sender,
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

  // sms.md /send returns only {"message":"Added to queue"} — no id. Correlate
  // the just-sent message by matching exact body + recipient suffix on the most
  // recent messages, so we can poll its delivery status later. Best-effort.
  async findRecentMessageId(
    workspaceId: string,
    params: { to: string; message: string },
  ): Promise<string | undefined> {
    if (!this.isConfigured) {
      return undefined;
    }
    const client = this.secureHttpClientService.getHttpClient(
      { timeout: 10_000, retries: 1 },
      { workspaceId, source: 'sms-md' },
    );
    // Recipient comes back without the country prefix (e.g. 69362004); match on
    // the trailing digits of the E.164 we sent.
    const toDigits = params.to.replace(/\D/g, '');

    try {
      const response = await client.get(this.messageBaseUrl, {
        params: { token: this.apiKey, perpage: 20 },
      });
      const rows = (response.data?.data ?? []) as SmsMdMessage[];
      const match = rows.find(
        (row) =>
          row.message === params.message &&
          toDigits.endsWith(row.to.replace(/\D/g, '')),
      );

      return match?.id;
    } catch (error) {
      this.logger.warn(
        `sms.md message lookup failed: ${(error as Error).message}`,
      );

      return undefined;
    }
  }

  // GET /v1/message/{id} → numeric statusId, mapped to our normalised status.
  async getDeliveryStatus(
    workspaceId: string,
    messageId: string,
  ): Promise<SmsDeliveryStatus | undefined> {
    if (!this.isConfigured) {
      return undefined;
    }
    const client = this.secureHttpClientService.getHttpClient(
      { timeout: 10_000, retries: 1 },
      { workspaceId, source: 'sms-md' },
    );

    try {
      const response = await client.get(`${this.messageBaseUrl}/${messageId}`, {
        params: { token: this.apiKey },
      });
      const statusId = Number(response.data?.statusId);

      return Number.isFinite(statusId) ? mapSmsMdStatusId(statusId) : undefined;
    } catch (error) {
      this.logger.warn(
        `sms.md status lookup failed for ${messageId}: ${(error as Error).message}`,
      );

      return undefined;
    }
  }
}
