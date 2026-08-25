import { Injectable, Logger } from '@nestjs/common';

import { randomUUID } from 'crypto';

import { isDefined } from 'twenty-shared/utils';
import { ILike } from 'typeorm';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { SYSTEM_ACTOR } from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';
import {
  MOLDOVA_CALLING_CODE,
  MOLDOVA_COUNTRY_CODE,
  MOLDOVA_DIAL_PREFIX,
  PROJECT_CODE_BY_DID,
  PROJECT_CODE_BY_PBX_GROUP,
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

  // Project resolution, in confidence order. Roistat states the project code
  // outright (it is configured per scenario), which is exact. For the majority
  // of calls — those on DIDs Roistat does not track — the only signals are the
  // PBX department that took the call and the DID that was dialled, both of
  // which need an operator-maintained map.
  async resolveProjectId(
    workspaceId: string,
    signals: {
      roistatProjectCode?: string;
      pbxGroupName?: string;
      calleeDid?: string;
    },
  ): Promise<string | undefined> {
    const code =
      signals.roistatProjectCode ??
      (isDefined(signals.pbxGroupName)
        ? PROJECT_CODE_BY_PBX_GROUP[signals.pbxGroupName]
        : undefined) ??
      (isDefined(signals.calleeDid)
        ? PROJECT_CODE_BY_DID[digitsOnly(signals.calleeDid)]
        : undefined);

    if (!isDefined(code)) {
      return undefined;
    }

    const repository =
      await this.globalWorkspaceOrmManager.getRepository<ProjectRow>(
        workspaceId,
        'project',
        { shouldBypassPermissionChecks: true },
      );

    const project = await repository.findOne({ where: { code } });

    if (!isDefined(project)) {
      this.logger.warn(`No project found for code ${code}`);

      return undefined;
    }

    return project.id;
  }
}
