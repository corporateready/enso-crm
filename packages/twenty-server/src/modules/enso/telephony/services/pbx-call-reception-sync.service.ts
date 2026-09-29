import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { MoldcellPbxClientService } from 'src/modules/enso/telephony/services/moldcell-pbx-client.service';
import { PBX_CALL_RECEPTION_SYNC_ENABLED } from 'src/modules/enso/telephony/telephony.constants';
import {
  type PbxGroupReceptionState,
  planDepartmentReception,
} from 'src/modules/enso/telephony/utils/plan-department-reception.util';

type WorkspaceMemberRow = {
  id: string;
  pbxLogin?: string | null;
  isAvailableForRouting?: boolean | null;
};

// Mirrors the "Accepting leads" toggle into the PBX, one way (CRM → PBX): a
// paused manager stops receiving their DEPARTMENTS' calls. The planning rules
// live in planDepartmentReception; this service only gathers PBX state and
// applies the plan.
//
// It is run on a transition only, never as a level sync. Every manager is
// deliberately paused in the CRM while the parked ROUTING backlog waits, and
// copying that state across would stop every department from ringing anyone.
//
// Runs in the background: a PBX outage must not hold up or fail the toggle,
// and the full read is ~30 PBX round-trips.
@Injectable()
export class PbxCallReceptionSyncService {
  private readonly logger = new Logger(PbxCallReceptionSyncService.name);

  // One queue for everyone, not one per member: the last-receiver check reads
  // colleagues' state, so two managers pausing at once must not both see the
  // other as still receiving. It also keeps a quick off→on→off in order.
  private syncQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly moldcellPbxClientService: MoldcellPbxClientService,
  ) {}

  scheduleSync(workspaceId: string, workspaceMemberId: string): void {
    if (
      !PBX_CALL_RECEPTION_SYNC_ENABLED ||
      !this.moldcellPbxClientService.isConfigured
    ) {
      return;
    }

    this.syncQueue = this.syncQueue
      .then(() => this.sync(workspaceId, workspaceMemberId))
      .catch((error) => {
        this.logger.warn(
          `PBX call reception sync for member ${workspaceMemberId} failed: ${(error as Error).message}`,
        );
      });
  }

  private async sync(
    workspaceId: string,
    workspaceMemberId: string,
  ): Promise<void> {
    // Read at run time rather than taking the value from the caller, so the
    // last queued sync always applies the member's latest state.
    const member = await this.loadMember(workspaceId, workspaceMemberId);

    if (!isDefined(member?.pbxLogin) || !member.pbxLogin) {
      return;
    }

    const login = member.pbxLogin;
    const isReceiving = member.isAvailableForRouting === true;

    const groups = await this.readGroupsOf(workspaceId, login);

    const plan = planDepartmentReception({ login, isReceiving, groups });

    await Promise.all(
      plan.toChange.map((groupId) =>
        this.moldcellPbxClientService.setGroupCallReception(
          workspaceId,
          login,
          groupId,
          isReceiving,
        ),
      ),
    );

    this.logger.log(
      `PBX call reception for ${login} → ${isReceiving ? 'on' : 'off'}: ` +
        `changed [${plan.toChange.join(', ')}], ` +
        `unchanged [${plan.unchanged.join(', ')}], ` +
        `personal line left alone [${plan.personal.join(', ')}]`,
    );

    if (plan.keptOnAsLastReceiver.length > 0) {
      this.logger.warn(
        `${login} stays on in [${plan.keptOnAsLastReceiver.join(', ')}]: ` +
          'nobody else receives those departments’ calls',
      );
    }
  }

  // The PBX only answers "which groups is this user in", so membership of the
  // manager's groups is rebuilt by asking that of every account.
  private async readGroupsOf(
    workspaceId: string,
    login: string,
  ): Promise<PbxGroupReceptionState[]> {
    const accounts =
      await this.moldcellPbxClientService.listAccounts(workspaceId);

    const groupsByLogin = await Promise.all(
      accounts.map(async (account) => ({
        login: account.name,
        groupIds: (
          await this.moldcellPbxClientService.listGroupsOfUser(
            workspaceId,
            account.name,
          )
        ).map((group) => group.id),
      })),
    );

    const ownGroupIds =
      groupsByLogin.find((entry) => entry.login === login)?.groupIds ?? [];

    return Promise.all(
      ownGroupIds.map(async (groupId) => {
        const memberLogins = groupsByLogin
          .filter((entry) => entry.groupIds.includes(groupId))
          .map((entry) => entry.login);

        // A personal line's status is never needed; skip the round-trip.
        const receivingLogins =
          memberLogins.length <= 1
            ? memberLogins
            : (
                await Promise.all(
                  memberLogins.map(async (memberLogin) =>
                    (await this.moldcellPbxClientService.isReceivingGroupCalls(
                      workspaceId,
                      memberLogin,
                      groupId,
                    ))
                      ? memberLogin
                      : undefined,
                  ),
                )
              ).filter(isDefined);

        return { groupId, memberLogins, receivingLogins };
      }),
    );
  }

  private loadMember(
    workspaceId: string,
    workspaceMemberId: string,
  ): Promise<WorkspaceMemberRow | null> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository =
          await this.globalWorkspaceOrmManager.getRepository<WorkspaceMemberRow>(
            workspaceId,
            'workspaceMember',
            { shouldBypassPermissionChecks: true },
          );

        return repository.findOne({ where: { id: workspaceMemberId } });
      },
      buildSystemAuthContext(workspaceId),
    );
  }
}
