import { Injectable, Logger } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';

import { InjectCacheStorage } from 'src/engine/core-modules/cache-storage/decorators/cache-storage.decorator';
import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';
import {
  type EnsoLeadLookupDealMatchDTO,
  type EnsoLeadLookupMatchDTO,
  type EnsoLeadLookupProjectDTO,
  type EnsoLeadLookupResultDTO,
} from 'src/modules/enso/record-lookup/dtos/enso-lead-lookup-match.dto';
import {
  ENSO_LEAD_LOOKUP_DAILY_ALLOWANCE,
  ENSO_LEAD_LOOKUP_MAX_MATCHES,
  ENSO_LEAD_LOOKUP_MIN_TERM_LENGTH,
} from 'src/modules/enso/record-lookup/enso-lead-lookup.constants';
import {
  type AssignmentRow,
  type MatchMode,
  type OpportunityRow,
  type PersonRow,
  type ProjectRow,
  type WorkspaceMemberRow,
  EnsoLeadBookReaderService,
} from 'src/modules/enso/record-lookup/services/enso-lead-book-reader.service';
import {
  buildDealLabel,
  buildDisplayName,
  buildOwnerName,
  earliest,
  latest,
  resolveDealStatus,
  resolveMatchMode,
} from 'src/modules/enso/record-lookup/utils/enso-lead-projection.util';
import {
  maskEmail,
  maskPhone,
} from 'src/modules/enso/record-lookup/utils/mask-identity.util';
import { EnsoViewerScopeService } from 'src/modules/enso/record-visibility/services/enso-viewer-scope.service';
import { EnsoPostHogService } from 'src/modules/enso/routing-availability/services/enso-posthog.service';

// Cross-book contact lookup.
//
// Sales managers only see the records they own, which also removes everyone
// else's records from normal search. That is correct for working a book and
// wrong for the one question a manager legitimately needs answered before they
// touch a lead: "is somebody already on this, and who?".
//
// So this deliberately reads past record visibility, and pays for that by
// returning a purpose-built projection instead of records — identity confirmed,
// ownership named, contact details withheld. Every call is counted and
// reported, because a lookup that cannot be audited is just a slower way to
// browse the whole database.
@Injectable()
export class EnsoLeadLookupService {
  private readonly logger = new Logger(EnsoLeadLookupService.name);

  constructor(
    private readonly bookReader: EnsoLeadBookReaderService,
    private readonly ensoPostHogService: EnsoPostHogService,
    private readonly ensoViewerScopeService: EnsoViewerScopeService,
    @InjectCacheStorage(CacheStorageNamespace.ModuleEnsoLookup)
    private readonly cacheStorage: CacheStorageService,
  ) {}

  async lookup(params: {
    workspaceId: string;
    workspaceMemberId: string;
    userWorkspaceId: string;
    searchTerm: string;
  }): Promise<EnsoLeadLookupResultDTO> {
    const { workspaceId, workspaceMemberId, userWorkspaceId } = params;
    const searchTerm = params.searchTerm.trim();

    // Someone who already sees every record has nothing to learn here, and the
    // audit trail should not fill up with admins searching their own CRM.
    const isViewerScoped = await this.ensoViewerScopeService.isViewerScoped({
      workspaceId,
      userWorkspaceId,
    });

    if (!isViewerScoped) {
      return {
        matches: [],
        dealMatches: [],
        isRateLimited: false,
        remainingLookupsToday: 0,
        isViewerScoped: false,
      };
    }

    if (searchTerm.length < ENSO_LEAD_LOOKUP_MIN_TERM_LENGTH) {
      return {
        matches: [],
        dealMatches: [],
        isRateLimited: false,
        remainingLookupsToday:
          await this.getRemainingAllowance(workspaceMemberId),
        isViewerScoped: true,
      };
    }

    const remainingBefore = await this.consumeAllowance(workspaceMemberId);

    if (remainingBefore < 0) {
      return {
        matches: [],
        dealMatches: [],
        isRateLimited: true,
        remainingLookupsToday: 0,
        isViewerScoped: true,
      };
    }

    const matchMode = resolveMatchMode(searchTerm);

    const { matches, dealMatches } = await this.findMatches({
      workspaceId,
      workspaceMemberId,
      searchTerm,
      matchMode,
    });

    this.reportLookup({
      workspaceId,
      workspaceMemberId,
      matchMode,
      matches,
      dealMatches,
    });

    return {
      matches,
      dealMatches,
      isRateLimited: false,
      remainingLookupsToday: remainingBefore,
      isViewerScoped: true,
    };
  }

  private async findMatches({
    workspaceId,
    workspaceMemberId,
    searchTerm,
    matchMode,
  }: {
    workspaceId: string;
    workspaceMemberId: string;
    searchTerm: string;
    matchMode: MatchMode;
  }): Promise<{
    matches: EnsoLeadLookupMatchDTO[];
    dealMatches: EnsoLeadLookupDealMatchDTO[];
  }> {
    return this.bookReader.runInWorkspaceContext(async () => {
      const [people, matchedDeals] = await Promise.all([
        this.bookReader.findPeopleBySearchTerm({
          workspaceId,
          searchTerm,
          matchMode,
          limit: ENSO_LEAD_LOOKUP_MAX_MATCHES,
        }),
        this.bookReader.findOpportunitiesBySearchTerm({
          workspaceId,
          searchTerm,
          matchMode,
          limit: ENSO_LEAD_LOOKUP_MAX_MATCHES,
        }),
      ]);

      // The contacts behind a matched deal are needed for its masked identity,
      // and they are not necessarily among the people the term matched.
      const dealContactIds = [
        ...new Set(
          matchedDeals
            .map((deal) => deal.pointOfContactId)
            .filter(isNonEmptyString),
        ),
      ];

      const dealContacts = await this.bookReader.findPeopleByIds(
        workspaceId,
        dealContactIds.filter(
          (personId) => !people.some((person) => person.id === personId),
        ),
      );

      const peopleById = new Map(
        [...people, ...dealContacts].map((person) => [person.id, person]),
      );

      const personIds = people.map((person) => person.id);

      const [assignments, opportunities] = await Promise.all([
        this.bookReader.findAssignmentsByPersonIds(workspaceId, personIds),
        this.bookReader.findOpportunitiesByPersonIds(workspaceId, personIds),
      ]);

      const projectIds = [
        ...new Set(
          [...assignments, ...opportunities, ...matchedDeals]
            .map((row) => row.projectId)
            .filter(isNonEmptyString),
        ),
      ];
      const ownerIds = [
        ...new Set(
          [
            ...assignments.map((row) => row.managerId),
            ...opportunities.map((row) => row.ownerId),
            ...matchedDeals.map((row) => row.ownerId),
          ].filter(isNonEmptyString),
        ),
      ];

      const [projectsById, ownersById] = await Promise.all([
        this.bookReader.findProjectsByIds(workspaceId, projectIds),
        this.bookReader.findOwnersByIds(workspaceId, ownerIds),
      ]);

      return {
        matches: people.map((person) =>
          this.buildMatch({
            person,
            matchMode,
            workspaceMemberId,
            assignments: assignments.filter(
              (row) => row.personId === person.id,
            ),
            opportunities: opportunities.filter(
              (row) => row.pointOfContactId === person.id,
            ),
            projectsById,
            ownersById,
          }),
        ),
        dealMatches: matchedDeals.map((deal) =>
          this.buildDealMatch({
            deal,
            workspaceMemberId,
            person: isNonEmptyString(deal.pointOfContactId)
              ? (peopleById.get(deal.pointOfContactId) ?? null)
              : null,
            assignment: assignments.find(
              (row) =>
                row.personId === deal.pointOfContactId &&
                row.projectId === deal.projectId,
            ),
            projectsById,
            ownersById,
          }),
        ),
      };
    });
  }

  private buildMatch({
    person,
    matchMode,
    workspaceMemberId,
    assignments,
    opportunities,
    projectsById,
    ownersById,
  }: {
    person: PersonRow;
    matchMode: MatchMode;
    workspaceMemberId: string;
    assignments: AssignmentRow[];
    opportunities: OpportunityRow[];
    projectsById: Map<string, ProjectRow>;
    ownersById: Map<string, WorkspaceMemberRow>;
  }): EnsoLeadLookupMatchDTO {
    const projectIds = [
      ...new Set(
        [...assignments, ...opportunities]
          .map((row) => row.projectId)
          .filter(isNonEmptyString),
      ),
    ];

    const projects = projectIds.map((projectId) =>
      this.buildProject({
        projectId,
        workspaceMemberId,
        assignment: assignments.find((row) => row.projectId === projectId),
        projectOpportunities: opportunities.filter(
          (row) => row.projectId === projectId,
        ),
        projectsById,
        ownersById,
      }),
    );

    return {
      personId: person.id,
      displayName: buildDisplayName(person),
      matchedOn: matchMode,
      maskedPhone: maskPhone(
        person.phones?.primaryPhoneCallingCode,
        person.phones?.primaryPhoneNumber,
      ),
      maskedEmail: maskEmail(person.emails?.primaryEmail),
      firstTouchAt: person.firstTouchAt ?? null,
      isMine: projects.some((project) => project.isMine),
      projects,
    };
  }

  private buildDealMatch({
    deal,
    workspaceMemberId,
    person,
    assignment,
    projectsById,
    ownersById,
  }: {
    deal: OpportunityRow;
    workspaceMemberId: string;
    person: PersonRow | null;
    assignment: AssignmentRow | undefined;
    projectsById: Map<string, ProjectRow>;
    ownersById: Map<string, WorkspaceMemberRow>;
  }): EnsoLeadLookupDealMatchDTO {
    const project = isNonEmptyString(deal.projectId)
      ? projectsById.get(deal.projectId)
      : undefined;
    const ownerId = deal.ownerId ?? assignment?.managerId ?? null;
    const owner = isNonEmptyString(ownerId) ? ownersById.get(ownerId) : null;

    return {
      opportunityId: deal.id,
      dealLabel: buildDealLabel(deal.source),
      personId: deal.pointOfContactId ?? null,
      displayName: buildDisplayName(person),
      maskedPhone: maskPhone(
        person?.phones?.primaryPhoneCallingCode,
        person?.phones?.primaryPhoneNumber,
      ),
      maskedEmail: maskEmail(person?.emails?.primaryEmail),
      projectName: project?.name ?? null,
      projectCode: project?.code ?? null,
      ownerName: buildOwnerName(owner),
      ownerWorkspaceMemberId: ownerId,
      isMine: ownerId === workspaceMemberId,
      dealStatus: resolveDealStatus([deal]),
      firstContactAt: deal.firstContactAt ?? null,
      lastTouchAt: deal.lastTouchAt ?? null,
    };
  }

  private buildProject({
    projectId,
    workspaceMemberId,
    assignment,
    projectOpportunities,
    projectsById,
    ownersById,
  }: {
    projectId: string;
    workspaceMemberId: string;
    assignment: AssignmentRow | undefined;
    projectOpportunities: OpportunityRow[];
    projectsById: Map<string, ProjectRow>;
    ownersById: Map<string, WorkspaceMemberRow>;
  }): EnsoLeadLookupProjectDTO {
    const project = projectsById.get(projectId);
    // The assignment manager is the standing owner of the contact for this
    // project; a deal owner only stands in when there is no assignment yet.
    const ownerId =
      assignment?.managerId ??
      projectOpportunities.find((row) => isNonEmptyString(row.ownerId))
        ?.ownerId ??
      null;
    const owner = isNonEmptyString(ownerId) ? ownersById.get(ownerId) : null;

    return {
      projectId,
      projectName: project?.name ?? null,
      projectCode: project?.code ?? null,
      ownerName: buildOwnerName(owner),
      ownerWorkspaceMemberId: ownerId,
      isMine: ownerId === workspaceMemberId,
      firstContactAt: earliest([
        assignment?.assignedAt ?? null,
        ...projectOpportunities.map((row) => row.firstContactAt ?? null),
      ]),
      lastTouchAt: latest([
        assignment?.lastContactAt ?? null,
        ...projectOpportunities.map((row) => row.lastTouchAt ?? null),
      ]),
      dealStatus: resolveDealStatus(projectOpportunities),
    };
  }

  private getAllowanceKey(workspaceMemberId: string): string {
    const day = new Date().toISOString().slice(0, 10);

    return `lookups:${day}:${workspaceMemberId}`;
  }

  private async getRemainingAllowance(
    workspaceMemberId: string,
  ): Promise<number> {
    const used =
      (await this.cacheStorage.get<number>(
        this.getAllowanceKey(workspaceMemberId),
      )) ?? 0;

    return Math.max(ENSO_LEAD_LOOKUP_DAILY_ALLOWANCE - used, 0);
  }

  // Returns what is left AFTER this lookup, or -1 when the allowance is spent.
  private async consumeAllowance(workspaceMemberId: string): Promise<number> {
    const key = this.getAllowanceKey(workspaceMemberId);
    const used = (await this.cacheStorage.get<number>(key)) ?? 0;

    if (used >= ENSO_LEAD_LOOKUP_DAILY_ALLOWANCE) {
      return -1;
    }

    // Two days of TTL so a lookup just before midnight cannot leave a counter
    // behind that suppresses the next day.
    await this.cacheStorage.set(key, used + 1, 2 * 24 * 60 * 60 * 1000);

    return ENSO_LEAD_LOOKUP_DAILY_ALLOWANCE - (used + 1);
  }

  private reportLookup({
    workspaceId,
    workspaceMemberId,
    matchMode,
    matches,
    dealMatches,
  }: {
    workspaceId: string;
    workspaceMemberId: string;
    matchMode: MatchMode;
    matches: EnsoLeadLookupMatchDTO[];
    dealMatches: EnsoLeadLookupDealMatchDTO[];
  }): void {
    const foreignMatches = matches.filter((match) => !match.isMine);
    const foreignDealMatches = dealMatches.filter((match) => !match.isMine);

    // The search term itself is never recorded: it is somebody's phone number
    // or name, and the audit question is who looked at whose book, not what was
    // typed.
    this.logger.log(
      `lead lookup by member ${workspaceMemberId}: ${matchMode}, ${matches.length} contact(s) and ${dealMatches.length} deal(s), ${foreignMatches.length + foreignDealMatches.length} owned by others`,
    );

    this.ensoPostHogService.capture({
      event: 'lead_lookup_performed',
      distinctId: workspaceMemberId,
      properties: {
        workspaceId,
        matchMode,
        matchCount: matches.length,
        dealMatchCount: dealMatches.length,
        foreignMatchCount: foreignMatches.length + foreignDealMatches.length,
        ownerWorkspaceMemberIds: [
          ...new Set(
            [
              ...foreignMatches.flatMap((match) =>
                match.projects.map((project) => project.ownerWorkspaceMemberId),
              ),
              ...foreignDealMatches.map(
                (match) => match.ownerWorkspaceMemberId,
              ),
            ].filter(isNonEmptyString),
          ),
        ],
      },
    });
  }
}
