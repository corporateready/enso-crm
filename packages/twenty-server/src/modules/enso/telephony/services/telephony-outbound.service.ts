import { Injectable, Logger } from '@nestjs/common';

import { randomUUID } from 'crypto';

import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { SYSTEM_ACTOR } from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';
import { MOLDCELL_EXTERNAL_ID_PREFIX } from 'src/modules/enso/telephony/telephony.constants';
import { MoldcellPbxClientService } from 'src/modules/enso/telephony/services/moldcell-pbx-client.service';
import { type OutboundActivityRow } from 'src/modules/enso/telephony/services/outbound-call-ingest.service';

type PhonesValue = {
  primaryPhoneNumber?: string | null;
  primaryPhoneCallingCode?: string | null;
};

type PersonRow = { id: string; phones?: PhonesValue | null };

type WorkspaceMemberRow = {
  id: string;
  name?: { firstName?: string | null; lastName?: string | null } | null;
  pbxLogin?: string | null;
};

// The manager pressed a button, so the row's actor is THEM, not "ENSO CRM" —
// unlike a PBX-observed call, which genuinely has no CRM actor.
type ManualActor = {
  source: 'MANUAL';
  workspaceMemberId: string;
  name: string;
  context: object;
};

export type CallViaPbxResult = {
  success: boolean;
  error?: string;
  // The outboundActivity the manager's later outcome click should update, rather
  // than creating a second row for the same call.
  activityId?: string;
};

// Manager-initiated click-to-call.
//
// `makeCall` is a two-legged callback: the PBX rings the MANAGER first, then
// bridges the client. So this is the same mechanism as "request a callback" —
// there is exactly one origination command, and both UI ideas collapse onto it.
//
// The activity is written HERE, at the click, rather than waiting for the PBX
// pushes. Two reasons: the manager needs a row to hang their outcome and notes
// on immediately, and a call that never connects (they do not answer their own
// leg) should still be visible as an attempt. The push ingest then adopts this
// row and fills in duration, recording and outcome.
//
// Deliberately NOT consent-gated. Consent on the `call` channel governs
// marketing dialling; a manager returning a lead's own call is 1:1 work, and the
// existing "Call manually" path has no gate either. Blocking it here would just
// push managers off-system, which is exactly what loses us the recording.
@Injectable()
export class TelephonyOutboundService {
  private readonly logger = new Logger(TelephonyOutboundService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly moldcellPbxClientService: MoldcellPbxClientService,
  ) {}

  async callViaPbx(params: {
    workspaceId: string;
    workspaceMemberId: string;
    personId?: string;
    opportunityId?: string;
    taskId?: string;
  }): Promise<CallViaPbxResult> {
    const { workspaceId, workspaceMemberId, personId, opportunityId, taskId } =
      params;

    if (!isNonEmptyString(personId)) {
      return { success: false, error: 'Pick a contact to call.' };
    }

    const context = await this.resolveContext(
      workspaceId,
      workspaceMemberId,
      personId,
    );

    if (!isNonEmptyString(context.pbxLogin)) {
      return {
        success: false,
        error:
          'Your PBX account is not linked yet. Ask an admin to set your PBX login.',
      };
    }

    if (!isNonEmptyString(context.phone)) {
      return { success: false, error: 'This contact has no phone number.' };
    }

    const result = await this.moldcellPbxClientService.makeCall(
      workspaceId,
      context.pbxLogin,
      context.phone,
    );

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const activityId = await this.logAttempt({
      workspaceId,
      workspaceMemberId,
      actor: context.actor,
      personId,
      phone: context.phone,
      fromIdentity: context.pbxLogin,
      // The PBX's own CallID. If it matches the `callid` on the pushes, the
      // ingest correlates exactly; if it does not, ingest falls back to matching
      // on (manager, number, recency). Either way this call is logged once.
      ...(isDefined(result.callId) ? { callId: result.callId } : {}),
      ...(isNonEmptyString(opportunityId) ? { opportunityId } : {}),
      ...(isNonEmptyString(taskId) ? { taskId } : {}),
    });

    this.logger.log(
      `makeCall placed by member ${workspaceMemberId} to ${context.phone} (activity ${activityId})`,
    );

    return { success: true, activityId };
  }

  private async resolveContext(
    workspaceId: string,
    workspaceMemberId: string,
    personId: string,
  ): Promise<{ pbxLogin?: string; phone?: string; actor?: ManualActor }> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const memberRepository =
          await this.globalWorkspaceOrmManager.getRepository<WorkspaceMemberRow>(
            workspaceId,
            'workspaceMember',
            { shouldBypassPermissionChecks: true },
          );
        const personRepository =
          await this.globalWorkspaceOrmManager.getRepository<PersonRow>(
            workspaceId,
            'person',
            { shouldBypassPermissionChecks: true },
          );

        const member = await memberRepository.findOne({
          where: { id: workspaceMemberId },
        });
        const person = await personRepository.findOne({
          where: { id: personId },
        });

        return {
          ...(isNonEmptyString(member?.pbxLogin)
            ? { pbxLogin: member.pbxLogin }
            : {}),
          ...(isDefined(member)
            ? { actor: this.buildActor(workspaceMemberId, member) }
            : {}),
          ...(isDefined(person)
            ? { phone: this.buildE164(person.phones) }
            : {}),
        };
      },
      buildSystemAuthContext(workspaceId),
    );
  }

  private buildActor(
    workspaceMemberId: string,
    member: WorkspaceMemberRow,
  ): ManualActor {
    const name =
      `${member.name?.firstName ?? ''} ${member.name?.lastName ?? ''}`.trim();

    return {
      source: 'MANUAL',
      workspaceMemberId,
      name: name || 'Manager',
      context: {},
    };
  }

  private buildE164(
    phones: PhonesValue | null | undefined,
  ): string | undefined {
    const number = String(phones?.primaryPhoneNumber ?? '').replace(/\D/g, '');

    if (!number) {
      return undefined;
    }

    const callingCode = String(phones?.primaryPhoneCallingCode ?? '').replace(
      /\D/g,
      '',
    );

    // Phone storage in this workspace is inconsistent: some rows keep the
    // country code inside primaryPhoneNumber alongside a wrong calling code (see
    // findPersonByPhone). A number long enough to already be international is
    // taken as-is rather than having a second country code stapled on.
    if (number.length >= 11) {
      return `+${number}`;
    }

    if (!callingCode) {
      return undefined;
    }

    return `+${callingCode}${number.replace(/^0+/, '')}`;
  }

  private async logAttempt(params: {
    workspaceId: string;
    workspaceMemberId: string;
    actor?: ManualActor;
    personId: string;
    phone: string;
    fromIdentity: string;
    callId?: string;
    opportunityId?: string;
    taskId?: string;
  }): Promise<string> {
    const id = randomUUID();
    const occurredAt = new Date();

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const repository =
        await this.globalWorkspaceOrmManager.getRepository<OutboundActivityRow>(
          params.workspaceId,
          'outboundActivity',
          { shouldBypassPermissionChecks: true },
        );

      const lastPosition = await repository.maximum('position', undefined);

      await repository.insert({
        id,
        name: `Outbound call · ${params.phone} · ${occurredAt
          .toISOString()
          .slice(0, 16)
          .replace('T', ' ')}`,
        channel: 'CALL',
        loggedVia: 'CRM_INITIATED',
        toIdentity: params.phone,
        fromIdentity: params.fromIdentity,
        occurredAt,
        personId: params.personId,
        performedById: params.workspaceMemberId,
        // Prefixed the same way the pushes are, so a matching CallID
        // correlates on the externalId lookup with no special-casing.
        ...(isDefined(params.callId)
          ? {
              externalId: `${MOLDCELL_EXTERNAL_ID_PREFIX}:${params.callId}`,
            }
          : {}),
        ...(isDefined(params.opportunityId)
          ? { opportunityId: params.opportunityId }
          : {}),
        ...(isDefined(params.taskId) ? { taskId: params.taskId } : {}),
        position: (lastPosition ?? 0) + 1,
        createdBy: params.actor ?? SYSTEM_ACTOR,
        updatedBy: params.actor ?? SYSTEM_ACTOR,
      });
    }, buildSystemAuthContext(params.workspaceId));

    return id;
  }
}
