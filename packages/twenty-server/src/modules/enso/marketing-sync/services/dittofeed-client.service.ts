import { Injectable, Logger } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';

import { SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';

// Thin client over Dittofeed's Segment-compatible ingestion API.
// Endpoints: POST {base}/api/public/apps/identify and /track.
// Auth: Authorization: Basic <writeKey> — DITTOFEED_WRITE_KEY is the
// "Public Write Key" from Dittofeed → Settings → Authentication, used
// verbatim (Dittofeed exposes it already base64-encoded for Basic auth).
// Config is read from process.env, consistent with the other enso modules
// (chatwoot, company-enrichment). When unconfigured the calls no-op so a
// missing key never breaks the worker.

type IdentifyPayload = {
  userId: string;
  traits: Record<string, unknown>;
  messageId: string;
};

type TrackPayload = {
  userId: string;
  event: string;
  properties: Record<string, unknown>;
  timestamp: string;
  messageId: string;
};

@Injectable()
export class DittofeedClientService {
  private readonly logger = new Logger(DittofeedClientService.name);

  constructor(
    private readonly secureHttpClientService: SecureHttpClientService,
  ) {}

  private get baseUrl(): string | undefined {
    return process.env.DITTOFEED_API_URL?.replace(/\/$/, '') || undefined;
  }

  private get writeKey(): string | undefined {
    return process.env.DITTOFEED_WRITE_KEY || undefined;
  }

  get isConfigured(): boolean {
    return isNonEmptyString(this.baseUrl) && isNonEmptyString(this.writeKey);
  }

  async identify(workspaceId: string, payload: IdentifyPayload): Promise<void> {
    await this.post(workspaceId, 'identify', {
      userId: payload.userId,
      traits: payload.traits,
      messageId: payload.messageId,
    });
  }

  async track(workspaceId: string, payload: TrackPayload): Promise<void> {
    await this.post(workspaceId, 'track', {
      userId: payload.userId,
      event: payload.event,
      properties: payload.properties,
      timestamp: payload.timestamp,
      messageId: payload.messageId,
    });
  }

  private async post(
    workspaceId: string,
    endpoint: 'identify' | 'track',
    body: Record<string, unknown>,
  ): Promise<void> {
    if (!this.isConfigured) {
      this.logger.warn(
        `Dittofeed not configured (DITTOFEED_API_URL / DITTOFEED_WRITE_KEY); skipping ${endpoint}`,
      );

      return;
    }

    const client = this.secureHttpClientService.getHttpClient(
      { timeout: 10_000, retries: 2 },
      { workspaceId, source: 'dittofeed-sync' },
    );

    // Throws on failure so the enqueuing BullMQ job retries.
    await client.post(`${this.baseUrl}/api/public/apps/${endpoint}`, body, {
      headers: {
        Authorization: `Basic ${this.writeKey}`,
        'Content-Type': 'application/json',
      },
    });
  }
}
