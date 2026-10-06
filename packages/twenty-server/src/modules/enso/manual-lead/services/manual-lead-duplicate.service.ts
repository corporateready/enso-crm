import { Injectable } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';
import { ILike, In, IsNull } from 'typeorm';

import { InjectCacheStorage } from 'src/engine/core-modules/cache-storage/decorators/cache-storage.decorator';
import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { CLOSED_OPPORTUNITY_STAGES } from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';
import { MANUAL_LEAD_DUPLICATE_CHECK_DAILY_ALLOWANCE } from 'src/modules/enso/manual-lead/manual-lead.constants';
import { type EnsoManualLeadDuplicateCheckDTO } from 'src/modules/enso/manual-lead/dtos/manual-lead.dto';
import {
  type DuplicateCandidate,
  type DuplicateVerdict,
  resolveDuplicateVerdict,
} from 'src/modules/enso/manual-lead/utils/resolve-duplicate-verdict.util';
import {
  arePhonesSameLine,
  phoneShortlistSuffix,
} from 'src/modules/enso/person-merge/utils/phone-match.util';
import {
  buildDisplayName,
  buildOwnerName,
} from 'src/modules/enso/record-lookup/utils/enso-lead-projection.util';
import {
  maskEmail,
  maskPhone,
} from 'src/modules/enso/record-lookup/utils/mask-identity.util';
import { EnsoPostHogService } from 'src/modules/enso/routing-availability/services/enso-posthog.service';
import { escapeLikePattern } from 'src/modules/enso/shared/utils/escape-like-pattern.util';
import { toE164 } from 'src/modules/enso/shared/utils/person-phone.util';

type PersonRow = {
  id: string;
  createdAt?: Date | null;
  name?: { firstName?: string | null; lastName?: string | null } | null;
  phones?: {
    primaryPhoneNumber?: string | null;
    primaryPhoneCallingCode?: string | null;
  } | null;
  emails?: { primaryEmail?: string | null } | null;
};

export type ContactKeys = {
  workspaceId: string;
  projectId: string;
  phoneNumber?: string | null;
  phoneCallingCode?: string | null;
  email?: string | null;
};

export type DuplicateEvaluation = {
  verdict: DuplicateVerdict;
  people: Map<string, PersonRow>;
};

// Finds the contacts a new lead would collide with, by the same phone rule the
// background merge uses (and exact email), and says who works each of them on
// the lead's project. Reads past record visibility on purpose — a manager
// cannot see a colleague's contact, which is exactly the one they must not add
// again — so what leaves this service is a masked projection, never a record.
@Injectable()
export class ManualLeadDuplicateService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly ensoPostHogService: EnsoPostHogService,
    @InjectCacheStorage(CacheStorageNamespace.ModuleEnsoLookup)
    private readonly cacheStorage: CacheStorageService,
  ) {}

  async evaluate(
    keys: ContactKeys,
    viewerWorkspaceMemberId: string,
  ): Promise<DuplicateEvaluation> {
    const { workspaceId, projectId } = keys;

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const people = await this.findMatchingPeople(keys);
        const personIds = people.map((person) => person.id);

        const candidates: DuplicateCandidate[] =
          personIds.length === 0
            ? []
            : await this.buildCandidates(workspaceId, projectId, people);

        return {
          verdict: resolveDuplicateVerdict(candidates, viewerWorkspaceMemberId),
          people: new Map(people.map((person) => [person.id, person])),
        };
      },
      buildSystemAuthContext(workspaceId),
    );
  }

  async check(
    keys: ContactKeys,
    viewerWorkspaceMemberId: string,
  ): Promise<EnsoManualLeadDuplicateCheckDTO> {
    if (!(await this.consumeAllowance(viewerWorkspaceMemberId))) {
      return {
        verdict: 'NEW',
        displayName: null,
        maskedPhone: null,
        maskedEmail: null,
        ownerName: null,
        hasOpenDeal: false,
        isRateLimited: true,
      };
    }

    const { verdict, people } = await this.evaluate(
      keys,
      viewerWorkspaceMemberId,
    );

    // Who looked at whose book — never the number or name that was typed.
    this.ensoPostHogService.capture({
      event: 'manual_lead_duplicate_checked',
      distinctId: viewerWorkspaceMemberId,
      properties: {
        workspaceId: keys.workspaceId,
        projectId: keys.projectId,
        verdict: verdict.verdict,
        ...(verdict.verdict === 'BLOCKED'
          ? { ownerWorkspaceMemberId: verdict.ownerMemberId }
          : {}),
      },
    });

    if (verdict.verdict === 'NEW') {
      return {
        verdict: 'NEW',
        displayName: null,
        maskedPhone: null,
        maskedEmail: null,
        ownerName: null,
        hasOpenDeal: false,
        isRateLimited: false,
      };
    }

    const person = people.get(verdict.personId);

    return {
      verdict: verdict.verdict,
      displayName: buildDisplayName(person),
      maskedPhone: maskPhone(
        person?.phones?.primaryPhoneCallingCode,
        person?.phones?.primaryPhoneNumber,
      ),
      maskedEmail: maskEmail(person?.emails?.primaryEmail),
      ownerName:
        verdict.verdict === 'BLOCKED'
          ? await this.findOwnerName(keys.workspaceId, verdict.ownerMemberId)
          : null,
      hasOpenDeal:
        verdict.verdict === 'REUSE' ? verdict.hasOpenDealOnProject : false,
      isRateLimited: false,
    };
  }

  async findOwnerName(
    workspaceId: string,
    workspaceMemberId: string,
  ): Promise<string | null> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository = await this.getRepository(
          workspaceId,
          'workspaceMember',
        );

        return buildOwnerName(
          await repository.findOne({ where: { id: workspaceMemberId } }),
        );
      },
      buildSystemAuthContext(workspaceId),
    );
  }

  private async findMatchingPeople(keys: ContactKeys): Promise<PersonRow[]> {
    const repository = await this.getRepository(keys.workspaceId, 'person');
    const matches = new Map<string, PersonRow>();

    const email = keys.email?.trim().toLowerCase();

    if (isNonEmptyString(email)) {
      const byEmail: PersonRow[] = await repository.find({
        where: {
          emails: { primaryEmail: ILike(escapeLikePattern(email)) },
          deletedAt: IsNull(),
        },
      });

      byEmail.forEach((person) => matches.set(person.id, person));
    }

    const phone = toE164(keys.phoneCallingCode, keys.phoneNumber);
    const phoneSuffix = phoneShortlistSuffix(phone);

    if (isNonEmptyString(phoneSuffix)) {
      const shortlist: PersonRow[] = await repository.find({
        where: {
          phones: { primaryPhoneNumber: ILike(`%${phoneSuffix}`) },
          deletedAt: IsNull(),
        },
      });

      // The shortlist also returns longer numbers that merely end in the same
      // digits; only a confirmed same line counts.
      shortlist
        .filter((person) =>
          arePhonesSameLine(
            phone,
            toE164(
              person.phones?.primaryPhoneCallingCode,
              person.phones?.primaryPhoneNumber,
            ) ?? person.phones?.primaryPhoneNumber,
          ),
        )
        .forEach((person) => matches.set(person.id, person));
    }

    return [...matches.values()];
  }

  private async buildCandidates(
    workspaceId: string,
    projectId: string,
    people: PersonRow[],
  ): Promise<DuplicateCandidate[]> {
    const personIds = people.map((person) => person.id);

    const assignmentRepository = await this.getRepository(
      workspaceId,
      'personProjectAssignment',
    );
    const opportunityRepository = await this.getRepository(
      workspaceId,
      'opportunity',
    );

    const assignments: {
      personId: string;
      managerId?: string | null;
      endedAt?: Date | null;
      assignedAt?: Date | null;
    }[] = await assignmentRepository.find({
      where: { personId: In(personIds), projectId },
    });

    const opportunities: {
      pointOfContactId: string;
      ownerId?: string | null;
      stage?: string | null;
    }[] = await opportunityRepository.find({
      where: { pointOfContactId: In(personIds), projectId },
    });

    const closedStages: readonly string[] = CLOSED_OPPORTUNITY_STAGES;

    return people.map((person) => {
      const activeAssignment = assignments
        .filter(
          (assignment) =>
            assignment.personId === person.id && !isDefined(assignment.endedAt),
        )
        .sort(
          (first, second) =>
            new Date(second.assignedAt ?? 0).getTime() -
            new Date(first.assignedAt ?? 0).getTime(),
        )[0];

      const openDeals = opportunities.filter(
        (opportunity) =>
          opportunity.pointOfContactId === person.id &&
          !closedStages.includes(opportunity.stage ?? ''),
      );

      return {
        personId: person.id,
        createdAt: person.createdAt ? new Date(person.createdAt) : null,
        projectOwnerId:
          activeAssignment?.managerId ??
          openDeals.find((deal) => isNonEmptyString(deal.ownerId))?.ownerId ??
          null,
        hasOpenDealOnProject: openDeals.length > 0,
      };
    });
  }

  private async consumeAllowance(workspaceMemberId: string): Promise<boolean> {
    const day = new Date().toISOString().slice(0, 10);
    const key = `manual-lead-checks:${day}:${workspaceMemberId}`;
    const used = (await this.cacheStorage.get<number>(key)) ?? 0;

    if (used >= MANUAL_LEAD_DUPLICATE_CHECK_DAILY_ALLOWANCE) {
      return false;
    }

    await this.cacheStorage.set(key, used + 1, 2 * 24 * 60 * 60 * 1000);

    return true;
  }

  private getRepository(workspaceId: string, objectNameSingular: string) {
    return this.globalWorkspaceOrmManager.getRepository<any>(
      workspaceId,
      objectNameSingular,
      { shouldBypassPermissionChecks: true },
    );
  }
}
