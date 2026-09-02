import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';
import { IsNull } from 'typeorm';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { CallIdentityService } from 'src/modules/enso/telephony/services/call-identity.service';
import { type MoldcellContactResponse } from 'src/modules/enso/telephony/types/telephony.types';
import { normalizeE164 } from 'src/modules/enso/telephony/utils/normalize-call-event.util';

type AssignmentRow = {
  id: string;
  personId?: string | null;
  projectId?: string | null;
  managerId?: string | null;
  endedAt?: Date | string | null;
};

type WorkspaceMemberRow = {
  id: string;
  pbxLogin?: string | null;
  isAvailableForRouting?: boolean | null;
};

// Module A — the synchronous half of telephony.
//
// The PBX asks "who owns this caller?" while the phone is still ringing and can
// transfer the call straight to the answer. Everything here is read-only: no
// person, activity or deal is created, because a ring-time decision must not
// depend on write latency and must be safe to repeat.
//
// Answering with no `responsible` is always valid — the PBX then applies its own
// dial plan — so every uncertain case degrades to that rather than guessing at
// an owner and sending the call to the wrong person.
@Injectable()
export class TelephonyContactService {
  private readonly logger = new Logger(TelephonyContactService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly callIdentityService: CallIdentityService,
  ) {}

  async resolveContact(
    workspaceId: string,
    phone: string | undefined,
    diversion: unknown,
  ): Promise<MoldcellContactResponse> {
    const callerE164 = normalizeE164(phone, diversion);

    if (!isDefined(callerE164)) {
      return {};
    }

    const person = await this.callIdentityService.lookupPersonByPhone(
      workspaceId,
      callerE164,
    );

    // An unknown caller has no owner by definition. The PBX still gets a 200 and
    // routes by its dial plan.
    if (!isDefined(person)) {
      return {};
    }

    const contactName = [person.name?.firstName, person.name?.lastName]
      .filter(isDefined)
      .join(' ')
      .trim();

    // The dialled DID tells us which project the caller is ringing about, which
    // matters because ownership is per (person, project): the same contact can
    // belong to different managers on different developments.
    const resolved = await this.callIdentityService.resolveEntryPoint(
      workspaceId,
      { calleeDid: typeof diversion === 'string' ? diversion : undefined },
    );

    const responsible = await this.findResponsiblePbxLogin(
      workspaceId,
      person.id,
      resolved?.projectId,
    );

    return {
      ...(contactName ? { contact_name: contactName } : {}),
      ...(isDefined(responsible) ? { responsible } : {}),
    };
  }

  private async findResponsiblePbxLogin(
    workspaceId: string,
    personId: string,
    projectId: string | undefined,
  ): Promise<string | undefined> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const assignmentRepository =
          await this.globalWorkspaceOrmManager.getRepository<AssignmentRow>(
            workspaceId,
            'personProjectAssignment',
            { shouldBypassPermissionChecks: true },
          );

        // Sticky ownership: an assignment with no endedAt is the manager who
        // owns this customer.
        const active: AssignmentRow[] = await assignmentRepository.find({
          where: { personId, endedAt: IsNull() },
        });

        if (active.length === 0) {
          return undefined;
        }

        const forProject = isDefined(projectId)
          ? active.find((a) => a.projectId === projectId)
          : undefined;

        // Fall back to the single assignment only when there is exactly one.
        // With several, guessing would hand the call to a manager who owns this
        // contact on a different project — worse than letting the PBX queue it.
        const chosen =
          forProject ?? (active.length === 1 ? active[0] : undefined);

        if (!isDefined(chosen?.managerId)) {
          if (!isDefined(forProject) && active.length > 1) {
            this.logger.log(
              `Caller owned on ${active.length} projects and the dialled DID maps to none — leaving the call to the PBX dial plan`,
            );
          }

          return undefined;
        }

        const memberRepository =
          await this.globalWorkspaceOrmManager.getRepository<WorkspaceMemberRow>(
            workspaceId,
            'workspaceMember',
            { shouldBypassPermissionChecks: true },
          );

        const manager = await memberRepository.findOne({
          where: { id: chosen.managerId },
        });

        // The PBX identifies its users by login, so an owner we cannot name in
        // the PBX's own terms is not routable — see the pbxLogin field.
        if (!isDefined(manager?.pbxLogin) || !manager.pbxLogin) {
          return undefined;
        }

        // Do not ring someone who has turned off lead reception; the PBX would
        // otherwise send a live call to a phone nobody is watching.
        if (manager.isAvailableForRouting === false) {
          return undefined;
        }

        return manager.pbxLogin;
      },
      buildSystemAuthContext(workspaceId),
    );
  }
}
