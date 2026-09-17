import { Injectable } from '@nestjs/common';

import { In, type ObjectLiteral } from 'typeorm';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';

export type PersonRow = {
  id: string;
  name?: { firstName?: string | null; lastName?: string | null } | null;
  phones?: {
    primaryPhoneNumber?: string | null;
    primaryPhoneCallingCode?: string | null;
  } | null;
  emails?: { primaryEmail?: string | null } | null;
  firstTouchAt?: Date | null;
};

export type AssignmentRow = {
  personId: string;
  projectId: string | null;
  managerId: string | null;
  assignedAt?: Date | null;
  lastContactAt?: Date | null;
};

export type OpportunityRow = {
  id: string;
  // Nullable: a deal found by name can be a B2B deal that hangs off the company
  // and has no contact on it yet.
  pointOfContactId: string | null;
  projectId: string | null;
  ownerId: string | null;
  stage?: string | null;
  source?: string | null;
  firstContactAt?: Date | null;
  lastTouchAt?: Date | null;
  utmSource?: string | null;
  utmCampaign?: string | null;
  firstTrafficType?: string | null;
  reengagementCount?: number | null;
};

export type ProjectRow = {
  id: string;
  name?: string | null;
  code?: string | null;
};

export type WorkspaceMemberRow = {
  id: string;
  name?: { firstName?: string | null; lastName?: string | null } | null;
  userEmail?: string | null;
};

export type ActivityRow = {
  id: string;
  personId: string | null;
  kind?: string | null;
  occurredAt?: Date | null;
  createdAt?: Date | null;
};

export type MatchMode = 'PHONE' | 'EMAIL' | 'NAME';

// The raw reads behind the cross-book lookup and the read-only lead profile.
//
// Every query here bypasses record visibility on purpose, which is why they all
// live in one place: what the callers do with the rows — mask them, count them,
// name the owner — is where the judgement is, and it is easier to audit when
// the "reads past scoping" part is this small and this obvious.
//
// Callers are responsible for running these inside
// `executeInWorkspaceContext`, because a single panel makes several reads that
// belong in one context.
@Injectable()
export class EnsoLeadBookReaderService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  runInWorkspaceContext<T>(callback: () => Promise<T>): Promise<T> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(callback);
  }

  async findPeopleBySearchTerm({
    workspaceId,
    searchTerm,
    matchMode,
    limit,
  }: {
    workspaceId: string;
    searchTerm: string;
    matchMode: MatchMode;
    limit: number;
  }): Promise<PersonRow[]> {
    const repository = await this.getRepository<PersonRow>(
      workspaceId,
      'person',
    );

    const queryBuilder = repository
      .createQueryBuilder('person')
      .where('"person"."deletedAt" IS NULL');

    if (matchMode === 'EMAIL') {
      queryBuilder.andWhere('"person"."emailsPrimaryEmail" ILIKE :term', {
        term: `%${searchTerm}%`,
      });
    } else if (matchMode === 'PHONE') {
      // Match on the trailing digits so a local number finds an E.164 record
      // and the other way round.
      queryBuilder.andWhere('"person"."phonesPrimaryPhoneNumber" LIKE :term', {
        term: `%${trailingDigits(searchTerm)}`,
      });
    } else {
      // COALESCE, not plain concatenation: half the intake contacts arrive with
      // only a first name, and `'Ana' || NULL` is NULL, which would silently
      // make them unfindable.
      queryBuilder.andWhere(
        `(COALESCE("person"."nameFirstName", '') || ' ' || COALESCE("person"."nameLastName", '')) ILIKE :term`,
        { term: `%${searchTerm}%` },
      );
    }

    return queryBuilder.take(limit).getMany();
  }

  async findPeopleByIds(
    workspaceId: string,
    personIds: string[],
  ): Promise<PersonRow[]> {
    if (personIds.length === 0) {
      return [];
    }

    const repository = await this.getRepository<PersonRow>(
      workspaceId,
      'person',
    );

    return repository.find({ where: { id: In(personIds) } });
  }

  async findPersonById(
    workspaceId: string,
    personId: string,
  ): Promise<PersonRow | null> {
    const repository = await this.getRepository<PersonRow>(
      workspaceId,
      'person',
    );

    return repository.findOne({ where: { id: personId } });
  }

  // Deals are searched by name, which is the only thing a manager can type: the
  // composite name ("Call | 69… | ARTIMA") carries the phone number, so the
  // match is made on it but the name itself never leaves this service.
  async findOpportunitiesBySearchTerm({
    workspaceId,
    searchTerm,
    matchMode,
    limit,
  }: {
    workspaceId: string;
    searchTerm: string;
    matchMode: MatchMode;
    limit: number;
  }): Promise<OpportunityRow[]> {
    if (matchMode === 'EMAIL') {
      return [];
    }

    const repository = await this.getRepository<OpportunityRow>(
      workspaceId,
      'opportunity',
    );

    const term =
      matchMode === 'PHONE' ? trailingDigits(searchTerm) : searchTerm;

    return repository
      .createQueryBuilder('opportunity')
      .where('"opportunity"."deletedAt" IS NULL')
      .andWhere('"opportunity"."name" ILIKE :term', { term: `%${term}%` })
      .orderBy('"opportunity"."createdAt"', 'DESC')
      .take(limit)
      .getMany();
  }

  async findOpportunityById(
    workspaceId: string,
    opportunityId: string,
  ): Promise<OpportunityRow | null> {
    const repository = await this.getRepository<OpportunityRow>(
      workspaceId,
      'opportunity',
    );

    return repository.findOne({ where: { id: opportunityId } });
  }

  async findAssignmentsByPersonIds(
    workspaceId: string,
    personIds: string[],
  ): Promise<AssignmentRow[]> {
    if (personIds.length === 0) {
      return [];
    }

    const repository = await this.getRepository<AssignmentRow>(
      workspaceId,
      'personProjectAssignment',
    );

    return repository.find({ where: { personId: In(personIds) } });
  }

  async findOpportunitiesByPersonIds(
    workspaceId: string,
    personIds: string[],
  ): Promise<OpportunityRow[]> {
    if (personIds.length === 0) {
      return [];
    }

    const repository = await this.getRepository<OpportunityRow>(
      workspaceId,
      'opportunity',
    );

    return repository.find({ where: { pointOfContactId: In(personIds) } });
  }

  async findProjectsByIds(
    workspaceId: string,
    projectIds: string[],
  ): Promise<Map<string, ProjectRow>> {
    if (projectIds.length === 0) {
      return new Map();
    }

    const repository = await this.getRepository<ProjectRow>(
      workspaceId,
      'project',
    );

    const projects = await repository.find({ where: { id: In(projectIds) } });

    return new Map(projects.map((project) => [project.id, project]));
  }

  async findOwnersByIds(
    workspaceId: string,
    ownerIds: string[],
  ): Promise<Map<string, WorkspaceMemberRow>> {
    if (ownerIds.length === 0) {
      return new Map();
    }

    const repository = await this.getRepository<WorkspaceMemberRow>(
      workspaceId,
      'workspaceMember',
    );

    const owners = await repository.find({ where: { id: In(ownerIds) } });

    return new Map(owners.map((owner) => [owner.id, owner]));
  }

  // Counts and dates only. The profile says how much conversation there has
  // been and when it last happened; what was actually said stays with the owner.
  async summarizeActivity(
    workspaceId: string,
    personId: string,
    objectNameSingular: 'inboundActivity' | 'outboundActivity',
  ): Promise<{ count: number; lastAt: Date | null }> {
    const repository = await this.getRepository<ActivityRow>(
      workspaceId,
      objectNameSingular,
    );

    const [rows, count] = await repository.findAndCount({
      where: { personId },
      // occurredAt is backfilled from the provider and can be missing on rows
      // written before the channel reported one, so the row order comes from
      // createdAt and the displayed date falls back to it.
      order: { createdAt: 'DESC' },
      take: 1,
    });

    const [lastRow] = rows;

    return {
      count,
      lastAt: lastRow?.occurredAt ?? lastRow?.createdAt ?? null,
    };
  }

  private getRepository<T extends ObjectLiteral>(
    workspaceId: string,
    objectNameSingular: string,
  ) {
    return this.globalWorkspaceOrmManager.getRepository<T>(
      workspaceId,
      objectNameSingular,
      { shouldBypassPermissionChecks: true },
    );
  }
}

// Seven digits is the shortest tail that still identifies a subscriber line in
// both country plans we work in, so a number pasted with or without its prefix
// finds the same record.
const trailingDigits = (searchTerm: string) =>
  searchTerm.replace(/\D/g, '').slice(-7);
