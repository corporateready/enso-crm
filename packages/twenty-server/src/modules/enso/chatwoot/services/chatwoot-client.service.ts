import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import axios, { type AxiosInstance } from 'axios';
import { isDefined } from 'twenty-shared/utils';

export type ChatwootConversationMeta = {
  conversationId: string;
  contactName: string | null;
  channelType: string | null;
  status: string | null;
  // Chatwoot's own messaging-window verdict: false when the channel's reply
  // window is closed (FB/IG 24h, extended to 7d when human-agent is enabled), so
  // we never reimplement Meta's policy. null when Chatwoot doesn't report it.
  canReply: boolean | null;
  assigneeName: string | null;
  assigneeId: number | null;
  createdAt: number | null;
  lastActivityAt: number | null;
};

export type ChatwootAttachment = {
  id: number;
  fileType: string | null;
  dataUrl: string | null;
  fileName: string | null;
};

export type ChatwootMessage = {
  id: number;
  content: string;
  // true = from the contact; false = from an agent (our side).
  incoming: boolean;
  // Internal note (not delivered to the contact).
  isPrivate: boolean;
  senderName: string | null;
  createdAt: string | null;
  attachments: ChatwootAttachment[];
};

export type ChatwootAgentSummary = {
  id: number;
  name: string | null;
  email: string | null;
  availabilityStatus: string | null;
};

export type ChatwootCannedResponse = {
  shortCode: string;
  content: string;
};

export type ChatwootUploadFile = {
  buffer: Buffer;
  fileName: string;
  contentType: string;
};

// Thin client over the two Chatwoot HTTP APIs we use:
//   • Application API (account-scoped `api_access_token`) — agents, conversation
//     read/reply (incl. attachments + private notes), status, canned responses,
//     inbox membership. Auth: CHATWOOT_API_TOKEN.
//   • Platform API (Platform-App `api_access_token`) — user provisioning + per-agent
//     access tokens (for attributed replies). Auth: CHATWOOT_PLATFORM_TOKEN.
// Methods THROW on HTTP failure — callers decide whether to swallow (best-effort
// on-claim push) or surface (the read/reply endpoints).
@Injectable()
export class ChatwootClientService {
  get baseUrl(): string | undefined {
    return process.env.CHATWOOT_BASE_URL?.replace(/\/$/, '') || undefined;
  }

  get accountId(): string {
    return process.env.CHATWOOT_ACCOUNT_ID || '1';
  }

  // ActionCable endpoint for realtime push, derived from the base URL
  // (https → wss). Chatwoot mounts the cable at `/cable`.
  get websocketUrl(): string | undefined {
    const base = this.baseUrl;

    return isDefined(base) ? `${base.replace(/^http/, 'ws')}/cable` : undefined;
  }

  private get apiToken(): string | undefined {
    return process.env.CHATWOOT_API_TOKEN || undefined;
  }

  private get platformToken(): string | undefined {
    return process.env.CHATWOOT_PLATFORM_TOKEN || undefined;
  }

  isConfigured(): boolean {
    return isDefined(this.baseUrl) && isDefined(this.apiToken);
  }

  isPlatformConfigured(): boolean {
    return isDefined(this.baseUrl) && isDefined(this.platformToken);
  }

  // Account-scoped Application API. Pass `asToken` to act as a specific agent
  // (e.g. post a reply attributed to the claiming manager).
  private applicationApi(asToken?: string): AxiosInstance {
    if (!this.isConfigured()) {
      throw new Error('Chatwoot Application API is not configured.');
    }

    return axios.create({
      baseURL: `${this.baseUrl}/api/v1/accounts/${this.accountId}`,
      headers: { api_access_token: asToken ?? (this.apiToken as string) },
      timeout: 20_000,
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
      timeout: 20_000,
    });
  }

  // --- Application API ---------------------------------------------------

  // An agent's `id` IS the underlying user id (used for login + assignee_id).
  async findAgentIdByEmail(email: string): Promise<number | undefined> {
    const normalized = email.trim().toLowerCase();
    const agents = await this.listAgents();

    return agents.find((agent) => agent.email?.toLowerCase() === normalized)
      ?.id;
  }

  async listAgents(): Promise<ChatwootAgentSummary[]> {
    const { data } = await this.applicationApi().get<any[]>('/agents');

    return (data ?? []).map((agent) => ({
      id: agent.id,
      name: agent.name ?? agent.available_name ?? null,
      email: agent.email ?? null,
      availabilityStatus: agent.availability_status ?? null,
    }));
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

  // open | resolved | pending (snooze uses snoozed_until; keep to the 3 toggles).
  async toggleStatus(
    conversationId: number | string,
    status: 'open' | 'resolved' | 'pending',
    asToken?: string,
  ): Promise<void> {
    await this.applicationApi(asToken).post(
      `/conversations/${conversationId}/toggle_status`,
      { status },
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

  async listCannedResponses(): Promise<ChatwootCannedResponse[]> {
    const { data } =
      await this.applicationApi().get<any[]>('/canned_responses');

    return (data ?? []).map((row) => ({
      shortCode: row.short_code ?? '',
      content: row.content ?? '',
    }));
  }

  async getConversationMeta(
    conversationId: number | string,
  ): Promise<ChatwootConversationMeta> {
    const { data } = await this.applicationApi().get<any>(
      `/conversations/${conversationId}`,
    );

    const assignee = data?.meta?.assignee ?? null;

    return {
      conversationId: String(conversationId),
      contactName: data?.meta?.sender?.name ?? null,
      channelType: data?.meta?.channel ?? null,
      status: data?.status ?? null,
      canReply: typeof data?.can_reply === 'boolean' ? data.can_reply : null,
      assigneeName: assignee?.name ?? null,
      assigneeId: assignee?.id ?? null,
      createdAt: isDefined(data?.created_at)
        ? data.created_at * 1000
        : isDefined(data?.timestamp)
          ? data.timestamp * 1000
          : null,
      lastActivityAt: isDefined(data?.last_activity_at)
        ? data.last_activity_at * 1000
        : null,
    };
  }

  // Messages oldest → newest. Keeps agent + contact messages and private notes
  // (flagged), drops activity rows (message_type 2).
  async listMessages(
    conversationId: number | string,
  ): Promise<ChatwootMessage[]> {
    const { data } = await this.applicationApi().get<{ payload: any[] }>(
      `/conversations/${conversationId}/messages`,
    );

    return (data.payload ?? [])
      .filter((m) => m.message_type === 0 || m.message_type === 1)
      .map((m) => ({
        id: m.id,
        content: m.content ?? '',
        // 0 = incoming (contact), 1 = outgoing (agent).
        incoming: m.message_type === 0,
        isPrivate: m.private === true,
        senderName: m.sender?.name ?? null,
        createdAt: isDefined(m.created_at)
          ? new Date(m.created_at * 1000).toISOString()
          : null,
        attachments: (m.attachments ?? []).map((a: any) => ({
          id: a.id,
          fileType: a.file_type ?? null,
          dataUrl: a.data_url ?? a.thumb_url ?? null,
          fileName: a.file_name ?? null,
        })),
      }))
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  }

  // Send a message: outgoing reply or private note, with optional file/image
  // attachments. Multipart when files are present (Chatwoot expects `attachments[]`).
  async sendMessage(
    conversationId: number | string,
    params: {
      content?: string;
      asToken?: string;
      isPrivate?: boolean;
      attachments?: ChatwootUploadFile[];
    },
  ): Promise<ChatwootMessage> {
    const path = `/conversations/${conversationId}/messages`;
    let response: { data: any };

    if (isDefined(params.attachments) && params.attachments.length > 0) {
      const form = new FormData();

      form.append('content', params.content ?? '');
      form.append('message_type', 'outgoing');
      form.append('private', params.isPrivate ? 'true' : 'false');

      for (const file of params.attachments) {
        form.append(
          'attachments[]',
          new Blob([new Uint8Array(file.buffer)], { type: file.contentType }),
          file.fileName,
        );
      }

      response = await this.applicationApi(params.asToken).post(path, form);
    } else {
      response = await this.applicationApi(params.asToken).post(path, {
        content: params.content ?? '',
        message_type: 'outgoing',
        private: params.isPrivate === true,
      });
    }

    const data = response.data;

    return {
      id: data.id,
      content: data.content ?? params.content ?? '',
      incoming: false,
      isPrivate: data.private === true,
      senderName: data.sender?.name ?? null,
      createdAt: isDefined(data.created_at)
        ? new Date(data.created_at * 1000).toISOString()
        : new Date().toISOString(),
      attachments: (data.attachments ?? []).map((a: any) => ({
        id: a.id,
        fileType: a.file_type ?? null,
        dataUrl: a.data_url ?? null,
        fileName: a.file_name ?? null,
      })),
    };
  }

  // Fetch an attachment's bytes server-side (its URL sits behind Chatwoot auth),
  // so the panel can render it without exposing the token.
  async fetchAttachment(
    url: string,
  ): Promise<{ data: Buffer; contentType: string }> {
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      headers: { api_access_token: this.apiToken as string },
      timeout: 20_000,
    });

    return {
      data: Buffer.from(response.data),
      contentType:
        response.headers['content-type'] ?? 'application/octet-stream',
    };
  }

  // --- Platform API ------------------------------------------------------

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

  // The agent's own access token — used to post replies attributed to them.
  async getUserAccessToken(userId: number): Promise<string | undefined> {
    if (!this.isPlatformConfigured()) {
      return undefined;
    }

    const { data } = await this.platformApi().get<{ access_token?: string }>(
      `/users/${userId}`,
    );

    return data.access_token ?? undefined;
  }

  // The agent's realtime pubsub token — authenticates the ActionCable
  // RoomChannel subscription (the browser receives push events keyed by it).
  async getUserPubsubToken(userId: number): Promise<string | undefined> {
    if (!this.isPlatformConfigured()) {
      return undefined;
    }

    const { data } = await this.platformApi().get<{ pubsub_token?: string }>(
      `/users/${userId}`,
    );

    return data.pubsub_token ?? undefined;
  }
}
