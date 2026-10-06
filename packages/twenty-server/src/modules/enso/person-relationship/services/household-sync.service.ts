import { Injectable, Logger } from '@nestjs/common';

import { randomUUID } from 'crypto';

import { isDefined } from 'twenty-shared/utils';
import { In, IsNull, Not } from 'typeorm';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import {
  groupConnectedPeople,
  type HouseholdCandidate,
  planHouseholds,
} from 'src/modules/enso/person-relationship/utils/plan-households.util';

type LinkRow = {
  personId?: string | null;
  relatedPersonId?: string | null;
  relationType?: string | null;
};

type PersonRow = {
  id: string;
  householdId?: string | null;
  createdAt?: Date | string | null;
  name?: { firstName?: string | null; lastName?: string | null } | null;
};

// Raw inserts bypass the create resolver that fills the createdBy ACTOR, and
// its name columns are NOT NULL.
const SYSTEM_ACTOR = {
  source: 'SYSTEM',
  name: 'ENSO CRM',
  context: {},
} as const;

// A family bigger than this is a data fault (a bad import, a merge gone
// wrong), not a household; stop walking rather than pull the whole contact
// base into one record.
const MAX_HOUSEHOLD_SIZE = 500;

// Keeps every person's household in step with their family links: everyone
// connected through links shares one household, named "<Last name> Family".
// Runs after each family-link write (around the people on that link) and
// daily over the whole workspace to repair anything an edit could not see.
//
// All writes go straight to the repositories as the system, so they never
// re-enter the query hooks. Failures are logged and swallowed: a household
// out of step is cosmetic and self-heals on the daily pass, while a failed
// family-link write is not.
@Injectable()
export class HouseholdSyncService {
  private readonly logger = new Logger(HouseholdSyncService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async syncAround(workspaceId: string, personIds: string[]): Promise<void> {
    const seeds = [...new Set(personIds.filter(isDefined))];

    if (seeds.length === 0) {
      return;
    }

    await this.run(workspaceId, async (repositories) => {
      const reached = await this.collectConnected(repositories.link, seeds);

      await this.apply(
        workspaceId,
        repositories,
        reached.personIds,
        reached.links,
      );
    });
  }

  async reconcileWorkspace(workspaceId: string): Promise<void> {
    await this.run(workspaceId, async (repositories) => {
      const links: LinkRow[] = (
        await repositories.link.find({ where: { relationType: Not(IsNull()) } })
      ).filter(this.isCompleteLink);
      const peopleInHouseholds: PersonRow[] = await repositories.person.find({
        where: { householdId: Not(IsNull()) },
      });

      const personIds = [
        ...new Set([
          ...links.flatMap((link) => [link.personId, link.relatedPersonId]),
          ...peopleInHouseholds.map((person) => person.id),
        ]),
      ].filter(isDefined);

      await this.apply(workspaceId, repositories, personIds, links);
    });
  }

  private isCompleteLink = (link: LinkRow) =>
    isDefined(link.personId) &&
    isDefined(link.relatedPersonId) &&
    isDefined(link.relationType) &&
    link.personId !== link.relatedPersonId;

  private async collectConnected(
    linkRepository: any,
    seeds: string[],
  ): Promise<{ personIds: string[]; links: LinkRow[] }> {
    const seen = new Set(seeds);
    const links: LinkRow[] = [];
    let frontier = seeds;

    while (frontier.length > 0 && seen.size <= MAX_HOUSEHOLD_SIZE) {
      const found: LinkRow[] = (
        await linkRepository.find({
          where: [
            { personId: In(frontier) },
            { relatedPersonId: In(frontier) },
          ],
        })
      ).filter(this.isCompleteLink);

      links.push(...found);

      const next: string[] = [];

      for (const link of found) {
        for (const id of [link.personId, link.relatedPersonId]) {
          if (isDefined(id) && !seen.has(id)) {
            seen.add(id);
            next.push(id);
          }
        }
      }

      frontier = next;
    }

    return { personIds: [...seen], links };
  }

  private async apply(
    workspaceId: string,
    repositories: { person: any; household: any },
    personIds: string[],
    links: LinkRow[],
  ): Promise<void> {
    const people: PersonRow[] =
      personIds.length > 0
        ? await repositories.person.find({ where: { id: In(personIds) } })
        : [];
    const livePeople = new Map(people.map((person) => [person.id, person]));

    // Links to a deleted person do not hold a family together.
    const liveLinks = links
      .filter(
        (link) =>
          livePeople.has(link.personId as string) &&
          livePeople.has(link.relatedPersonId as string),
      )
      .map((link) => ({
        personId: link.personId as string,
        relatedPersonId: link.relatedPersonId as string,
      }));

    const groups: HouseholdCandidate[][] = groupConnectedPeople(
      [...livePeople.keys()],
      liveLinks,
    ).map((group) =>
      group.map((id) => {
        const person = livePeople.get(id) as PersonRow;

        return {
          id,
          householdId: person.householdId,
          firstName: person.name?.firstName,
          lastName: person.name?.lastName,
          createdAt: person.createdAt,
        };
      }),
    );

    const plan = planHouseholds(groups);

    for (const household of plan.create) {
      const householdId = randomUUID();
      const lastPosition = await repositories.household.maximum(
        'position',
        undefined,
      );

      await repositories.household.insert({
        id: householdId,
        name: household.name,
        position: (lastPosition ?? 0) + 1,
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
      });
      await repositories.person.update(
        { id: In(household.memberIds) },
        { householdId },
      );
    }

    for (const { householdId, memberIds } of plan.assign) {
      await repositories.person.update({ id: In(memberIds) }, { householdId });
    }

    if (plan.clear.length > 0) {
      await repositories.person.update(
        { id: In(plan.clear) },
        { householdId: null },
      );
    }

    // Only retire a household nobody points at any more: someone outside the
    // groups seen here may still belong to it.
    for (const householdId of plan.remove) {
      const remaining = await repositories.person.count({
        where: { householdId },
      });

      if (remaining === 0) {
        await repositories.household.softDelete({ id: householdId });
      }
    }

    const changes =
      plan.create.length +
      plan.assign.length +
      plan.clear.length +
      plan.remove.length;

    if (changes > 0) {
      this.logger.log(
        `households in ${workspaceId}: +${plan.create.length} created, ${plan.assign.length} regrouped, ${plan.clear.length} cleared, ${plan.remove.length} retired`,
      );
    }
  }

  private async run(
    workspaceId: string,
    callback: (repositories: {
      link: any;
      person: any;
      household: any;
    }) => Promise<void>,
  ): Promise<void> {
    try {
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const getRepository = (objectName: string) =>
            this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              objectName,
              { shouldBypassPermissionChecks: true },
            );

          await callback({
            link: await getRepository('personRelationship'),
            person: await getRepository('person'),
            household: await getRepository('household'),
          });
        },
        buildSystemAuthContext(workspaceId),
      );
    } catch (error) {
      this.logger.warn(
        `household sync failed in ${workspaceId}: ${(error as Error).message}`,
      );
    }
  }
}
