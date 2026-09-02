import { Injectable, Logger } from '@nestjs/common';

import { randomUUID } from 'crypto';

import { isDefined } from 'twenty-shared/utils';
import { ILike } from 'typeorm';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { SYSTEM_ACTOR } from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';
import {
  ANSWERED_OWNER_FALLBACK_EMAIL,
  type CallEntryPoint,
  ENTRY_POINT_BY_DID,
  ENTRY_POINT_BY_PBX_GROUP,
  ENTRY_POINT_BY_ROISTAT_SCENARIO,
  MOLDOVA_CALLING_CODE,
  MOLDOVA_COUNTRY_CODE,
  MOLDOVA_DIAL_PREFIX,
  ROMANIA_CALLING_CODE,
  ROMANIA_COUNTRY_CODE,
  ROMANIA_DIAL_PREFIX,
} from 'src/modules/enso/telephony/telephony.constants';

type ActorValue = { source: string; name: string; context?: object };

type PhonesValue = {
  primaryPhoneNumber?: string | null;
  primaryPhoneCallingCode?: string | null;
  primaryPhoneCountryCode?: string | null;
};

type PersonRow = {
  id: string;
  phones?: PhonesValue | null;
  position: number;
  createdBy?: ActorValue | null;
  updatedBy?: ActorValue | null;
};

type ProjectRow = { id: string; code?: string | null };

type WorkspaceMemberRow = {
  id: string;
  userEmail?: string | null;
  // Set per member in the CRM UI; the only reliable link to a PBX account.
  pbxLogin?: string | null;
};

// Custom/standard objects are reached by metadata name, so the row shapes above
// stand in for the generated entity classes.
type PersonRepository = WorkspaceRepository<PersonRow>;

const digitsOnly = (value: unknown): string =>
  String(value ?? '').replace(/\D/g, '');

// Split "+37368879173" into its country prefix and subscriber part.
const splitE164 = (e164: string): { dialPrefix?: string; national: string } => {
  const digits = digitsOnly(e164);

  if (digits.startsWith(MOLDOVA_DIAL_PREFIX)) {
    return {
      dialPrefix: MOLDOVA_DIAL_PREFIX,
      national: digits.slice(MOLDOVA_DIAL_PREFIX.length),
    };
  }

  if (digits.startsWith(ROMANIA_DIAL_PREFIX)) {
    return {
      dialPrefix: ROMANIA_DIAL_PREFIX,
      national: digits.slice(ROMANIA_DIAL_PREFIX.length),
    };
  }

  return { national: digits };
};

@Injectable()
export class CallIdentityService {
  private readonly logger = new Logger(CallIdentityService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  // Find the caller, or create them. A call from an unknown number is still a
  // lead, so the person is created with the phone alone — the name service falls
  // back to rendering the number until someone fills in a name.
  async resolvePersonId(
    workspaceId: string,
    callerE164: string,
  ): Promise<string | undefined> {
    // Every workspace-ORM call must run inside a workspace context; obtaining a
    // repository outside one throws.
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository =
          await this.globalWorkspaceOrmManager.getRepository<PersonRow>(
            workspaceId,
            'person',
            { shouldBypassPermissionChecks: true },
          );

        const existing = await this.findPersonByPhone(repository, callerE164);

        if (isDefined(existing)) {
          return existing.id;
        }

        return this.createPerson(repository, callerE164);
      },
      buildSystemAuthContext(workspaceId),
    );
  }

  // Phone storage in this workspace is genuinely inconsistent: some rows hold a
  // national number with the right calling code (`66453432` / `+373`), some hold
  // a number that already embeds the country code alongside a wrong calling code
  // (`37368969113` / `+40`), and some keep a trunk zero. An equality test on the
  // composite therefore misses most real matches, so we shortlist on the
  // subscriber-number suffix in SQL and confirm the match in code.
  private async findPersonByPhone(
    repository: PersonRepository,
    callerE164: string,
  ): Promise<PersonRow | undefined> {
    const { national } = splitE164(callerE164);

    if (national.length < 6) {
      return undefined;
    }

    const candidates = await repository.find({
      where: {
        phones: { primaryPhoneNumber: ILike(`%${national}`) },
      },
    });

    const target = digitsOnly(callerE164);

    return candidates.find((candidate) => {
      const stored = digitsOnly(candidate.phones?.primaryPhoneNumber);

      if (!stored) {
        return false;
      }

      // Stored value already carries the country code.
      if (stored === target) {
        return true;
      }

      // Stored value is the national part; rebuild it with its calling code.
      const callingCode = digitsOnly(candidate.phones?.primaryPhoneCallingCode);

      if (callingCode && `${callingCode}${stored}` === target) {
        return true;
      }

      // Trunk-zero national form, e.g. "068879173" for "+37368879173".
      const withoutTrunk = stored.replace(/^0+/, '');

      return withoutTrunk.length >= 6 && target.endsWith(withoutTrunk);
    });
  }

  private async createPerson(
    repository: PersonRepository,
    callerE164: string,
  ): Promise<string | undefined> {
    const { dialPrefix, national } = splitE164(callerE164);

    if (!national) {
      return undefined;
    }

    const id = randomUUID();
    const lastPosition = await repository.maximum('position', undefined);

    // Store the canonical split shape (national number + calling code) rather
    // than repeating the embedded-country-code variant that makes existing rows
    // hard to match.
    const callingCode =
      dialPrefix === ROMANIA_DIAL_PREFIX
        ? ROMANIA_CALLING_CODE
        : dialPrefix === MOLDOVA_DIAL_PREFIX
          ? MOLDOVA_CALLING_CODE
          : undefined;

    const countryCode =
      dialPrefix === ROMANIA_DIAL_PREFIX
        ? ROMANIA_COUNTRY_CODE
        : dialPrefix === MOLDOVA_DIAL_PREFIX
          ? MOLDOVA_COUNTRY_CODE
          : undefined;

    await repository.insert({
      id,
      phones: {
        primaryPhoneNumber: national,
        ...(isDefined(callingCode)
          ? { primaryPhoneCallingCode: callingCode }
          : {}),
        ...(isDefined(countryCode)
          ? { primaryPhoneCountryCode: countryCode }
          : {}),
      },
      position: (lastPosition ?? 0) + 1,
      createdBy: SYSTEM_ACTOR,
      updatedBy: SYSTEM_ACTOR,
    });

    this.logger.log(`Created person ${id} from inbound call ${callerE164}`);

    return id;
  }

  // Resolve the entry point: which project the lead belongs to, which queue
  // should handle it, and whether it is a sales lead at all.
  //
  // Confidence order. Roistat states the project code outright (it is configured
  // per scenario), so it wins on attribution — but a scenario override can still
  // set the queue, because two scenarios sharing a project may belong to
  // different teams. For the majority of calls, on DIDs Roistat does not track,
  // the only signals are the PBX department that took the call and the DID.
  async resolveEntryPoint(
    workspaceId: string,
    signals: {
      roistatProjectCode?: string;
      roistatScenario?: string;
      pbxGroupName?: string;
      calleeDid?: string;
    },
  ): Promise<{ projectId?: string; entryPoint: CallEntryPoint } | undefined> {
    const fromScenario = isDefined(signals.roistatScenario)
      ? ENTRY_POINT_BY_ROISTAT_SCENARIO[signals.roistatScenario]
      : undefined;

    const fromGroup = isDefined(signals.pbxGroupName)
      ? ENTRY_POINT_BY_PBX_GROUP[signals.pbxGroupName]
      : undefined;

    const fromDid = isDefined(signals.calleeDid)
      ? ENTRY_POINT_BY_DID[digitsOnly(signals.calleeDid)]
      : undefined;

    const mapped = fromScenario ?? fromGroup ?? fromDid;

    // Roistat's own project code is the most reliable attribution, but it says
    // nothing about the queue, so keep any queue the mapped entry point carries.
    const project = signals.roistatProjectCode ?? mapped?.project;

    // Nothing recognised this call at all — distinct from a recognised entry
    // point that deliberately produces no lead, which we still want to report.
    if (!isDefined(project) && !isDefined(mapped)) {
      return undefined;
    }

    const entryPoint: CallEntryPoint = {
      ...(isDefined(project) ? { project } : {}),
      ...(isDefined(mapped?.queue) ? { queue: mapped.queue } : {}),
      lead: mapped?.lead ?? true,
    };

    // A known non-lead entry point (an internal or test department) need not
    // belong to a project; there is nothing to look up.
    if (!isDefined(entryPoint.project)) {
      return { entryPoint };
    }

    const projectRow =
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const repository =
            await this.globalWorkspaceOrmManager.getRepository<ProjectRow>(
              workspaceId,
              'project',
              { shouldBypassPermissionChecks: true },
            );

          return repository.findOne({ where: { code: entryPoint.project } });
        },
        buildSystemAuthContext(workspaceId),
      );

    if (!isDefined(projectRow)) {
      this.logger.warn(`No project found for code ${entryPoint.project}`);

      return { entryPoint };
    }

    return { projectId: projectRow.id, entryPoint };
  }

  // Map the PBX login that answered onto a CRM workspace member.
  //
  // The two systems share no implicit key: PBX accounts carry personal gmail
  // addresses rather than @enso.ro ones (and several carry none at all), the
  // realName ordering is inconsistent, and workspaceMember has neither a phone
  // nor an extension. So the link is stated explicitly on the member record via
  // `pbxLogin`, which is exact and editable per person in the CRM.
  //
  // Falls back to a configured owner, because a CONNECTED deal with nobody on it
  // is worse than one parked on a known person — and the PBX reports a group
  // rather than a login whenever a department took the call.
  async resolveAnsweredOwnerMemberId(
    workspaceId: string,
    pbxLogin: string | undefined,
  ): Promise<string | undefined> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository =
          await this.globalWorkspaceOrmManager.getRepository<WorkspaceMemberRow>(
            workspaceId,
            'workspaceMember',
            { shouldBypassPermissionChecks: true },
          );

        if (isDefined(pbxLogin) && pbxLogin) {
          const byLogin = await repository.findOne({ where: { pbxLogin } });

          if (isDefined(byLogin)) {
            return byLogin.id;
          }

          this.logger.warn(
            `No workspace member has pbxLogin "${pbxLogin}" — falling back`,
          );
        }

        if (
          !isDefined(ANSWERED_OWNER_FALLBACK_EMAIL) ||
          !ANSWERED_OWNER_FALLBACK_EMAIL
        ) {
          return undefined;
        }

        const fallback = await repository.findOne({
          where: { userEmail: ANSWERED_OWNER_FALLBACK_EMAIL },
        });

        if (!isDefined(fallback)) {
          this.logger.warn(
            `Fallback owner ${ANSWERED_OWNER_FALLBACK_EMAIL} is not a workspace member`,
          );

          return undefined;
        }

        return fallback.id;
      },
      buildSystemAuthContext(workspaceId),
    );
  }
}
