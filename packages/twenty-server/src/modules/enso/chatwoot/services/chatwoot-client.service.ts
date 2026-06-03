import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import axios, { type AxiosInstance } from 'axios';
import { isDefined } from 'twenty-shared/utils';

// Thin client over the two Chatwoot HTTP APIs we use:
//   • Application API (account-scoped `api_access_token`) — agents, conversation
//     assignment, inbox membership. Auth: CHATWOOT_API_TOKEN.
//   • Platform API (Platform-App `api_access_token`) — user provisioning + SSO
//     login-token minting. Auth: CHATWOOT_PLATFORM_TOKEN (created in the
//     super-admin portal; account tokens get 401 on /platform/**).
// Methods THROW on HTTP failure — callers decide whether to swallow (the
// best-effort on-claim push) or surface (the SSO endpoint).
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

  private applicationApi(): AxiosInstance {
    if (!this.isConfigured()) {
      throw new Error('Chatwoot Application API is not configured.');
    }

    return axios.create({
      baseURL: `${this.baseUrl}/api/v1/accounts/${this.accountId}`,
      headers: { api_access_token: this.apiToken as string },
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

  // Deep link to a specific conversation inside the dashboard. Loaded by the
  // iframe AFTER the SSO URL has established the session (same-site cookie).
  conversationUrl(conversationId: number | string): string {
    return `${this.frontendUrl}/app/accounts/${this.accountId}/conversations/${conversationId}`;
  }
}
