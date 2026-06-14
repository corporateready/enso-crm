import { Injectable, Logger } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';

import { SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';

// Server-side reader for the Dittofeed Admin API (GET /api/admin/*). Used to
// fetch a person's message deliveries for the in-CRM marketing-journey widget,
// so the Admin API key never reaches the browser. Distinct from
// DittofeedClientService (the public identify/track write path). Config from
// process.env: DITTOFEED_API_URL (same instance base) + DITTOFEED_ADMIN_API_KEY
// (Bearer) + DITTOFEED_WORKSPACE_ID (the DITTOFEED workspace, NOT the CRM one).

export type MarketingDelivery = {
  channel: string;
  status: string;
  sentAt: string | null;
  templateId: string | null;
  journeyId: string | null;
};

@Injectable()
export class DittofeedAdminClientService {
  private readonly logger = new Logger(DittofeedAdminClientService.name);

  constructor(
    private readonly secureHttpClientService: SecureHttpClientService,
  ) {}

  private get baseUrl(): string | undefined {
    return process.env.DITTOFEED_API_URL?.replace(/\/$/, '') || undefined;
  }

  private get adminKey(): string | undefined {
    return process.env.DITTOFEED_ADMIN_API_KEY || undefined;
  }

  private get dittofeedWorkspaceId(): string | undefined {
    return process.env.DITTOFEED_WORKSPACE_ID || undefined;
  }

  get isConfigured(): boolean {
    return (
      isNonEmptyString(this.baseUrl) &&
      isNonEmptyString(this.adminKey) &&
      isNonEmptyString(this.dittofeedWorkspaceId)
    );
  }

  // All email/SMS messages Dittofeed sent to one user (= CRM person UUID).
  // Returns only sent messages (Dittofeed has no scheduled-send view).
  async getDeliveriesForUser(
    workspaceId: string,
    userId: string,
  ): Promise<MarketingDelivery[]> {
    if (!this.isConfigured || !isNonEmptyString(userId)) {
      return [];
    }

    const client = this.secureHttpClientService.getHttpClient(
      { timeout: 10_000, retries: 1 },
      { workspaceId, source: 'dittofeed-admin' },
    );

    const url =
      `${this.baseUrl}/api/admin/deliveries` +
      `?workspaceId=${encodeURIComponent(this.dittofeedWorkspaceId ?? '')}` +
      `&userId=${encodeURIComponent(userId)}&limit=50`;

    try {
      const response = await client.get(url, {
        headers: { Authorization: `Bearer ${this.adminKey}` },
      });

      const items: unknown[] = response.data?.items ?? [];

      // Only surface user-facing channels (skip the internal Webhook callbacks
      // we fire for journey state).
      return items
        .map((raw) => {
          const item = raw as Record<string, any>;
          const channel = item.variant?.type ?? 'Unknown';

          return {
            channel,
            status: item.status ?? 'Unknown',
            sentAt: item.sentAt ?? item.updatedAt ?? null,
            templateId: item.templateId ?? null,
            journeyId: item.journeyId ?? null,
          };
        })
        .filter((d) => d.channel === 'Email' || d.channel === 'Sms');
    } catch (error) {
      this.logger.warn(
        `Dittofeed deliveries fetch failed for user ${userId}: ${
          (error as Error).message
        }`,
      );

      return [];
    }
  }

  // Mirror CRM consent → Dittofeed subscription state for one user.
  // `changes` = {subscriptionGroupId: isSubscribed}. Throws on failure so the
  // enqueuing BullMQ job retries (unlike the read above, which swallows).
  async setSubscriptionAssignments(
    workspaceId: string,
    userId: string,
    changes: Record<string, boolean>,
  ): Promise<void> {
    if (
      !this.isConfigured ||
      !isNonEmptyString(userId) ||
      Object.keys(changes).length === 0
    ) {
      return;
    }

    const client = this.secureHttpClientService.getHttpClient(
      { timeout: 10_000, retries: 2 },
      { workspaceId, source: 'dittofeed-admin' },
    );

    await client.put(
      `${this.baseUrl}/api/admin/subscription-groups/assignments`,
      {
        workspaceId: this.dittofeedWorkspaceId,
        userUpdates: [{ userId, changes }],
      },
      { headers: { Authorization: `Bearer ${this.adminKey}` } },
    );
  }
}
