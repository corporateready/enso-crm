import { Injectable, Logger } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';

import {
  type EnsoLeadProfileActivityDTO,
  type EnsoLeadProfileDTO,
  type EnsoLeadProfileProjectDTO,
} from 'src/modules/enso/record-lookup/dtos/enso-lead-profile.dto';
import {
  type AssignmentRow,
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
} from 'src/modules/enso/record-lookup/utils/enso-lead-projection.util';
import {
  maskEmail,
  maskPhone,
} from 'src/modules/enso/record-lookup/utils/mask-identity.util';
import { EnsoViewerScopeService } from 'src/modules/enso/record-visibility/services/enso-viewer-scope.service';
import { EnsoPostHogService } from 'src/modules/enso/routing-availability/services/enso-posthog.service';

const EMPTY_ACTIVITY: EnsoLeadProfileActivityDTO = {
  inboundCount: 0,
  outboundCount: 0,
  lastInboundAt: null,
  lastOutboundAt: null,
};

// The read-only side of the cross-book lookup.
//
// A lookup line answers "is somebody on this?"; this answers the follow-up a
// manager always asks next — who, since when, how far along, and where did the
// lead come from — without handing over the record, because the record carries
// the contact details and the conversation.
//
// No allowance is spent here: the ids this accepts can only have come from a
// lookup, which is already counted, and refusing to expand a match the manager
// has already been shown would only teach them to guess instead. Every call is
// logged and reported all the same.
@Injectable()
export class EnsoLeadProfileService {
  private readonly logger = new Logger(EnsoLeadProfileService.name);

  constructor(
    private readonly bookReader: EnsoLeadBookReaderService,
    private readonly ensoPostHogService: EnsoPostHogService,
    private readonly ensoViewerScopeService: EnsoViewerScopeService,
  ) {}

  async profile({
    workspaceId,
    workspaceMemberId,
    userWorkspaceId,
    personId,
    opportunityId,
  }: {
    workspaceId: string;
    workspaceMemberId: string;
    userWorkspaceId: string;
    personId?: string | null;
    opportunityId?: string | null;
  }): Promise<EnsoLeadProfileDTO> {
    // An unscoped viewer opens the real record instead, so the profile has
    // nothing to add and stays out of the audit trail.
    const isViewerScoped = await this.ensoViewerScopeService.isViewerScoped({
      workspaceId,
      userWorkspaceId,
    });

    if (!isViewerScoped) {
      return this.buildEmptyProfile({ isViewerScoped: false });
    }

    if (!isNonEmptyString(personId) && !isNonEmptyString(opportunityId)) {
      return this.buildEmptyProfile({ isViewerScoped: true });
    }

    const profile = await this.bookReader.runInWorkspaceContext(async () => {
      const subjectDeal = isNonEmptyString(opportunityId)
        ? await this.bookReader.findOpportunityById(workspaceId, opportunityId)
        : null;

      // A deal opened from a deal match is described through its contact, which
      // is where the assignment and the activity hang.
      const resolvedPersonId = isNonEmptyString(personId)
        ? personId
        : (subjectDeal?.pointOfContactId ?? null);

      if (!isNonEmptyString(resolvedPersonId)) {
        return null;
      }

      const person = await this.bookReader.findPersonById(
        workspaceId,
        resolvedPersonId,
      );

      if (!isDefined(person)) {
        return null;
      }

      const [assignments, opportunities, inbound, outbound] = await Promise.all(
        [
          this.bookReader.findAssignmentsByPersonIds(workspaceId, [person.id]),
          this.bookReader.findOpportunitiesByPersonIds(workspaceId, [
            person.id,
          ]),
          this.bookReader.summarizeActivity(
            workspaceId,
            person.id,
            'inboundActivity',
          ),
          this.bookReader.summarizeActivity(
            workspaceId,
            person.id,
            'outboundActivity',
          ),
        ],
      );

      const projectIds = [
        ...new Set(
          [...assignments, ...opportunities]
            .map((row) => row.projectId)
            .filter(isNonEmptyString),
        ),
      ];
      const ownerIds = [
        ...new Set(
          [
            ...assignments.map((row) => row.managerId),
            ...opportunities.map((row) => row.ownerId),
          ].filter(isNonEmptyString),
        ),
      ];

      const [projectsById, ownersById] = await Promise.all([
        this.bookReader.findProjectsByIds(workspaceId, projectIds),
        this.bookReader.findOwnersByIds(workspaceId, ownerIds),
      ]);

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

      return this.buildProfile({
        person,
        projects,
        activity: {
          inboundCount: inbound.count,
          outboundCount: outbound.count,
          lastInboundAt: inbound.lastAt,
          lastOutboundAt: outbound.lastAt,
        },
      });
    });

    if (!isDefined(profile)) {
      return this.buildEmptyProfile({ isViewerScoped: true });
    }

    this.reportProfile({ workspaceId, workspaceMemberId, profile });

    return profile;
  }

  private buildProfile({
    person,
    projects,
    activity,
  }: {
    person: PersonRow;
    projects: EnsoLeadProfileProjectDTO[];
    activity: EnsoLeadProfileActivityDTO;
  }): EnsoLeadProfileDTO {
    return {
      isFound: true,
      isViewerScoped: true,
      personId: person.id,
      displayName: buildDisplayName(person),
      maskedPhone: maskPhone(
        person.phones?.primaryPhoneCallingCode,
        person.phones?.primaryPhoneNumber,
      ),
      maskedEmail: maskEmail(person.emails?.primaryEmail),
      firstTouchAt: person.firstTouchAt ?? null,
      isMine: projects.some((project) => project.isMine),
      projects,
      activity,
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
  }): EnsoLeadProfileProjectDTO {
    const project = projectsById.get(projectId);
    // The assignment manager is the standing owner of the contact for this
    // project; a deal owner only stands in when there is no assignment yet.
    const ownerId =
      assignment?.managerId ??
      projectOpportunities.find((row) => isNonEmptyString(row.ownerId))
        ?.ownerId ??
      null;
    const owner = isNonEmptyString(ownerId) ? ownersById.get(ownerId) : null;

    // The newest deal describes the current state of the relationship; older
    // closed ones only matter through the status bucket below.
    const latestDeal = [...projectOpportunities].sort(
      (a, b) =>
        (b.lastTouchAt ?? b.firstContactAt ?? new Date(0)).valueOf() -
        (a.lastTouchAt ?? a.firstContactAt ?? new Date(0)).valueOf(),
    )[0];

    return {
      projectId,
      projectName: project?.name ?? null,
      projectCode: project?.code ?? null,
      ownerName: buildOwnerName(owner),
      ownerEmail: owner?.userEmail ?? null,
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
      dealLabel: isDefined(latestDeal)
        ? buildDealLabel(latestDeal.source)
        : null,
      dealStage: latestDeal?.stage ?? null,
      dealStatus: resolveDealStatus(projectOpportunities),
      dealSource: latestDeal?.source ?? null,
      trafficType: latestDeal?.firstTrafficType ?? null,
      utmSource: latestDeal?.utmSource ?? null,
      utmCampaign: latestDeal?.utmCampaign ?? null,
      reengagementCount: latestDeal?.reengagementCount ?? 0,
    };
  }

  private buildEmptyProfile({
    isViewerScoped,
  }: {
    isViewerScoped: boolean;
  }): EnsoLeadProfileDTO {
    return {
      isFound: false,
      isViewerScoped,
      personId: null,
      displayName: '',
      maskedPhone: null,
      maskedEmail: null,
      firstTouchAt: null,
      isMine: false,
      projects: [],
      activity: EMPTY_ACTIVITY,
    };
  }

  private reportProfile({
    workspaceId,
    workspaceMemberId,
    profile,
  }: {
    workspaceId: string;
    workspaceMemberId: string;
    profile: EnsoLeadProfileDTO;
  }): void {
    // Who looked at whose lead, never the lead's name or number.
    this.logger.log(
      `lead profile opened by member ${workspaceMemberId}: person ${profile.personId}, ${profile.projects.length} project(s), mine=${profile.isMine}`,
    );

    this.ensoPostHogService.capture({
      event: 'lead_profile_opened',
      distinctId: workspaceMemberId,
      properties: {
        workspaceId,
        personId: profile.personId,
        isMine: profile.isMine,
        projectCount: profile.projects.length,
        ownerWorkspaceMemberIds: [
          ...new Set(
            profile.projects
              .map((project) => project.ownerWorkspaceMemberId)
              .filter(isNonEmptyString),
          ),
        ],
      },
    });
  }
}
