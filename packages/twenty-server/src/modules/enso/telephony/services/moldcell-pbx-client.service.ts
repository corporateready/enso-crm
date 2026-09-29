import { Injectable, Logger } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';

import { SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';
import {
  MOLDCELL_CRM_API_PATH,
  MOLDCELL_PBX_BASE_URL,
  MOLDCELL_PBX_TOKEN,
  PBX_COMMAND_TIMEOUT_MS,
} from 'src/modules/enso/telephony/telephony.constants';

export type PbxAccount = { name: string; realName?: string };

export type PbxGroup = { id: string; realName?: string };

export type MakeCallResult =
  | { success: true; callId?: string }
  | { success: false; error: string };

// CRM → PBX commands. The whole API is one form-encoded POST endpoint
// (`/sys/crm_api.wcgp`) with `cmd=` selecting the operation and `token=`
// authenticating; responses are bare text or JSON depending on the command.
//
// `makeCall` is the ONLY call-origination command the PBX exposes. It is a
// two-legged callback, documented verbatim as "сначала звонок на телефон
// менеджера, а потом соединит его с клиентом" — the PBX rings the MANAGER
// first, then bridges the client. That is why the CRM button cannot promise
// "we are dialling them now": the manager's own phone rings first.
//
// Consequences worth knowing before using it:
//   - No SIP device is required. Where the manager's leg rings is their own
//     "Приём звонков" setting in the cabinet (mobile / computer / all).
//   - It is billed as TWO legs, and the manager's leg is billed as an outbound
//     call if it forwards to an external mobile.
@Injectable()
export class MoldcellPbxClientService {
  private readonly logger = new Logger(MoldcellPbxClientService.name);

  constructor(
    private readonly secureHttpClientService: SecureHttpClientService,
  ) {}

  get isConfigured(): boolean {
    return (
      isNonEmptyString(MOLDCELL_PBX_BASE_URL) &&
      isNonEmptyString(MOLDCELL_PBX_TOKEN)
    );
  }

  // `user` accepts a login, an extension or a direct number; we always pass the
  // login from workspaceMember.pbxLogin, which is the explicit CRM↔PBX link.
  // `phone` is the client's number.
  async makeCall(
    workspaceId: string,
    user: string,
    phone: string,
  ): Promise<MakeCallResult> {
    if (!this.isConfigured) {
      return {
        success: false,
        error: 'The phone system is not configured.',
      };
    }

    const body = {
      cmd: 'makeCall',
      user,
      // Digits only: the PBX rejects a leading '+' on this parameter.
      phone: phone.replace(/\D/g, ''),
    };

    try {
      const response = await this.postCommand(workspaceId, body);

      if (response.status !== 200) {
        const error = this.readError(response.data);

        this.logger.warn(
          `makeCall(${user}) rejected with ${response.status}: ${error}`,
        );

        // The PBX's own wording is Russian and internal; the two cases a manager
        // can act on are separated here, and anything else is generic.
        return {
          success: false,
          error:
            response.status === 401
              ? 'The phone system rejected our credentials.'
              : 'The phone system refused the call. Check the number and your PBX account.',
        };
      }

      // A 200 answers with the bare CallID. Stored on the activity so the PBX
      // pushes about this call can correlate onto the row we are about to write.
      return { success: true, callId: this.readCallId(response.data) };
    } catch (error) {
      this.logger.warn(`makeCall(${user}) failed: ${(error as Error).message}`);

      return { success: false, error: 'Could not reach the phone system.' };
    }
  }

  // PBX users (`name` is the login that workspaceMember.pbxLogin holds).
  async listAccounts(workspaceId: string): Promise<PbxAccount[]> {
    const data = await this.queryCommand(workspaceId, { cmd: 'accounts' });

    return Array.isArray(data)
      ? data.filter(
          (account): account is PbxAccount =>
            isNonEmptyString((account as PbxAccount)?.name),
        )
      : [];
  }

  // The departments `user` belongs to. The PBX has no "members of a group"
  // query, so membership is only ever read from the user's side.
  async listGroupsOfUser(
    workspaceId: string,
    user: string,
  ): Promise<PbxGroup[]> {
    const data = await this.queryCommand(workspaceId, { cmd: 'groups', user });

    return Array.isArray(data)
      ? data.filter((group): group is PbxGroup =>
          isNonEmptyString((group as PbxGroup)?.id),
        )
      : [];
  }

  // The spec spells this command `subscribtionstatus`; the live PBX rejects
  // that with "Invalid parameters: [cmd]" and only answers `subscriptionStatus`.
  async isReceivingGroupCalls(
    workspaceId: string,
    user: string,
    groupId: string,
  ): Promise<boolean> {
    const data = await this.queryCommand(workspaceId, {
      cmd: 'subscriptionStatus',
      user,
      group_id: groupId,
    });

    if (
      typeof data !== 'object' ||
      data === null ||
      !('status' in data) ||
      ((data as { status: unknown }).status !== 'on' &&
        (data as { status: unknown }).status !== 'off')
    ) {
      throw new Error(
        `subscriptionStatus answered an unexpected body: ${JSON.stringify(data).slice(0, 200)}`,
      );
    }

    return (data as { status: string }).status === 'on';
  }

  // Always pass `groupId`: without it the PBX flips the user in EVERY group,
  // including the one-person group behind their personal line.
  async setGroupCallReception(
    workspaceId: string,
    user: string,
    groupId: string,
    isReceiving: boolean,
  ): Promise<void> {
    await this.queryCommand(workspaceId, {
      cmd: 'subscribeOnCalls',
      user,
      group_id: groupId,
      status: isReceiving ? 'on' : 'off',
    });
  }

  // For commands whose failure the caller handles itself: throws on anything
  // but a 200, with the PBX's own error text in the message.
  private async queryCommand(
    workspaceId: string,
    params: Record<string, string>,
  ): Promise<unknown> {
    if (!this.isConfigured) {
      throw new Error('The phone system is not configured.');
    }

    const response = await this.postCommand(workspaceId, params);

    if (response.status !== 200) {
      throw new Error(
        `${params.cmd} rejected with ${response.status}: ${this.readError(response.data)}`,
      );
    }

    return response.data;
  }

  private postCommand(workspaceId: string, params: Record<string, string>) {
    const client = this.secureHttpClientService.getHttpClient(
      {
        timeout: PBX_COMMAND_TIMEOUT_MS,
        // The PBX answers 400/401 with a JSON error body; read those instead of
        // letting axios turn them into an opaque throw.
        validateStatus: (status) => status < 500,
      },
      { workspaceId, source: 'moldcell-pbx' },
    );

    const body = new URLSearchParams({
      ...params,
      token: String(MOLDCELL_PBX_TOKEN),
    });

    return client.post<unknown>(
      `${String(MOLDCELL_PBX_BASE_URL).replace(/\/$/, '')}${MOLDCELL_CRM_API_PATH}`,
      body.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
    );
  }

  private readError(data: unknown): string {
    if (typeof data === 'object' && data !== null && 'error' in data) {
      return String((data as { error: unknown }).error);
    }

    return String(data ?? 'unknown error').slice(0, 200);
  }

  // The documented 200 response is the bare CallID, but a live call came back as
  // an object with no CallID in it, and String()-ing that produced the literal
  // id "[object Object]" — which then went into externalId, where two such rows
  // would collide and correlate the wrong call. So only a scalar is accepted.
  private readCallId(data: unknown): string | undefined {
    const raw =
      typeof data === 'object' && data !== null && 'CallID' in data
        ? (data as { CallID: unknown }).CallID
        : data;

    if (typeof raw !== 'string' && typeof raw !== 'number') {
      this.logger.warn(
        `makeCall answered 200 without a readable CallID: ${JSON.stringify(data).slice(0, 200)}`,
      );

      return undefined;
    }

    const callId = String(raw).trim();

    // A plausible id, not a sentence: the PBX's ids are short alphanumerics, and
    // anything else means we misread the response shape.
    return /^[\w.:-]{1,128}$/.test(callId) ? callId : undefined;
  }
}
