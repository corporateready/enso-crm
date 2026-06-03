import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import axios, { type AxiosInstance } from 'axios';
import { isDefined } from 'twenty-shared/utils';

export type ChatwootConversationMeta = {
  conversationId: string;
  contactName: string | null;
  channelType: string | null;
  status: string | null;
  lastActivityAt: number | null;
};

export type ChatwootMessage = {
  id: number;
  content: string;
  // true = from the contact; false = from an agent (our side).
  incoming: boolean;
  senderName: string | null;
  createdAt: string | null;
};

// Thin client over the two Chatwoot HTTP APIs we use:
//   • Application API (account-scoped `api_access_token`) — agents, conversation
//     assignment + messages (read/reply), inbox membership. Auth: CHATWOOT_API_TOKEN.
//   • Platform API (Platform-App `api_access_token`) — user provisioning + per-agent
//     access tokens (for attributed replies). Auth: CHATWOOT_PLATFORM_TOKEN (created
//     in the super-admin portal; account tokens get 401 on /platform/**).
// Methods THROW on HTTP failure — callers decide whether to swallow (the
// best-effort on-claim push) or surface (the read/reply endpoints).
@Injectable()
export class ChatwootClientService {
  get baseUrl(): string | undefined {
    return process.env.CHATWOOT_BASE_URL?.replace(/\/$/, '') || undefined;
  }

  get accountId(): string {
    return process.env.CHATWOOT_ACCOUNT_ID || '1';
  }

  // The host the embedded iframe/SSO session loads from. Same as the API base
  // unless the dashboard is served from a different origin.
  get frontendUrl(): string {
    return (
      process.env.CHATWOOT_FRONTEND_URL?.replace(/\/$/, '') ||
      this.baseUrl ||
      ''
    );
  }

  private get apiToken(): string | undefined {
    return process.env.CHATWOOT_API_TOKEN || undefined;
  }

  private get platformToken(): string | undefined {
    return process.env.CHATWOOT_PLATFORM_TOKEN || undefined;
  }

  // Application API works once the account creds are present (already live).
  isConfigured(): boolean {
    return isDefined(this.baseUrl) && isDefined(this.apiToken);
  }

  // Platform API additionally needs the Platform-App token (the Phase-5 gate
  // for SSO + provisioning).
  isPlatformConfigured(): boolean {
    return isDefined(this.baseUrl) && isDefined(this.platformToken);
  }

  // Account-scoped Application API. Pass `asToken` to act as a specific agent
  // (e.g. post a reply attributed to the claiming manager); defaults to the
  // account token.
  private applicationApi(asToken?: string): AxiosInstance {
    if (!this.isConfigured()) {
      throw new Error('Chatwoot Application API is not configured.');
    }

    return axios.create({
      baseURL: `${this.baseUrl}/api/v1/accounts/${this.accountId}`,
      headers: { api_access_token: asToken ?? (this.apiToken as string) },
      timeout: 10_000,
    });
  }

  private platformApi(): AxiosInstance {
    if (!this.isPlatformConfigured()) {
      throw new Error(
        'Chatwoot Platform API is not configured (CHATWOOT_PLATFORM_TOKEN missing).',
      );
    }

    return axios.create({
      baseURL: `${this.baseUrl}/platform/api/v1`,
      headers: { api_access_token: this.platformToken as string },
      timeout: 10_000,
    });
  }

  // --- Application API ---------------------------------------------------

  // In Chatwoot an agent's `id` IS the underlying user id — the same id used by
  // the Platform login endpoint and by conversation `assignee_id`.
  async findAgentIdByEmail(email: string): Promise<number | undefined> {
    const normalized = email.trim().toLowerCase();

    const { data } =
      await this.applicationApi().get<Array<{ id: number; email?: string }>>(
        '/agents',
      );

    return data.find((agent) => agent.email?.toLowerCase() === normalized)?.id;
  }

  async assignConversation(
    conversationId: number | string,
    assigneeId: number,
  ): Promise<void> {
    await this.applicationApi().post(
      `/conversations/${conversationId}/assignments`,
      { assignee_id: assigneeId },
    );
  }

  async listInboxIds(): Promise<number[]> {
    const { data } = await this.applicationApi().get<{
      payload: Array<{ id: number }>;
    }>('/inboxes');

    return (data.payload ?? []).map((inbox) => inbox.id);
  }

  async addInboxMember(inboxId: number, userId: number): Promise<void> {
    await this.applicationApi().post('/inbox_members', {
      inbox_id: inboxId,
      user_ids: [userId],
    });
  }

  // Conversation header info for the native panel.
  async getConversationMeta(
    conversationId: number | string,
  ): Promise<ChatwootConversationMeta> {
    const { data } = await this.applicationApi().get<any>(
      `/conversations/${conversationId}`,
    );

    return {
      conversationId: String(conversationId),
      contactName: data?.meta?.sender?.name ?? null,
      channelType: data?.meta?.channel ?? null,
      status: data?.status ?? null,
      lastActivityAt: isDefined(data?.last_activity_at)
        ? data.last_activity_at * 1000
        : null,
    };
  }

  // Public messages oldest → newest (drops private notes + activity rows).
  async listMessages(
    conversationId: number | string,
  ): Promise<ChatwootMessage[]> {
    const { data } = await this.applicationApi().get<{ payload: any[] }>(
      `/conversations/${conversationId}/messages`,
    );

    return (data.payload ?? [])
      .filter(
        (m) =>
          m.private !== true && (m.message_type === 0 || m.message_type === 1),
      )
      .map((m) => ({
        id: m.id,
        content: m.content ?? '',
        // 0 = incoming (from the contact), 1 = outgoing (from an agent).
        incoming: m.message_type === 0,
        senderName: m.sender?.name ?? null,
        createdAt: isDefined(m.created_at)
          ? new Date(m.created_at * 1000).toISOString()
          : null,
      }))
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  }

  // Post an outgoing reply. `asToken` (an agent's own access token) attributes it
  // to that manager; without it the message posts under the account token's user.
  async sendMessage(
    conversationId: number | string,
    content: string,
    asToken?: string,
  ): Promise<ChatwootMessage> {
    const { data } = await this.applicationApi(asToken).post<any>(
      `/conversations/${conversationId}/messages`,
      { content, message_type: 'outgoing' },
    );

    return {
      id: data.id,
      content: data.content ?? content,
      incoming: false,
      senderName: data.sender?.name ?? null,
      createdAt: isDefined(data.created_at)
        ? new Date(data.created_at * 1000).toISOString()
        : new Date().toISOString(),
    };
  }

  // --- Platform API ------------------------------------------------------

  // Idempotent at the caller level (we look the agent up by email first). The
  // generated password is never used — agents only ever enter via SSO.
  async createUser(params: {
    name: string;
    email: string;
  }): Promise<{ id: number }> {
    const { data } = await this.platformApi().post<{ id: number }>('/users', {
      name: params.name,
      email: params.email,
      password: `Sso!${randomUUID()}`,
    });

    return data;
  }

  async addAccountUser(
    userId: number,
    role: 'agent' | 'administrator' = 'agent',
  ): Promise<void> {
    await this.platformApi().post(`/accounts/${this.accountId}/account_users`, {
      user_id: userId,
      role,
    });
  }

  // 5-min, single-use SSO login URL for this user. Mint at the moment of iframe
  // render; never cache.
  async mintSsoUrl(userId: number): Promise<string> {
    const { data } = await this.platformApi().get<{ url: string }>(
      `/users/${userId}/login`,
    );

    return data.url;
  }

  // The agent's own access token — used to post replies attributed to them.
  // Requires the Platform token; returns undefined if unavailable.
  async getUserAccessToken(userId: number): Promise<string | undefined> {
    if (!this.isPlatformConfigured()) {
      return undefined;
    }

    const { data } = await this.platformApi().get<{ access_token?: string }>(
      `/users/${userId}`,
    );

    return data.access_token ?? undefined;
  }

  // Deep link to a specific conversation inside the dashboard. Loaded by the
  // iframe AFTER the SSO URL has established the session (same-site cookie).
  conversationUrl(conversationId: number | string): string {
    return `${this.frontendUrl}/app/accounts/${this.accountId}/conversations/${conversationId}`;
  }
}
