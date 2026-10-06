import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { InboundActivityNameService } from 'src/modules/enso/inbound-activity/services/inbound-activity-name.service';
import { canonicalizeUtmMedium } from 'src/modules/enso/inbound-activity/utils/canonicalize-utm-medium.util';
import {
  type NotifyManagerAssignmentJobData,
  type PostProjectDealJobData,
  type RecordActivityAttributionJobData,
  type RouteOpportunityJobData,
} from 'src/modules/enso/lead-pipeline/jobs/lead-pipeline-job.types';
import { NotifyManagerAssignmentJob } from 'src/modules/enso/lead-pipeline/jobs/notify-manager-assignment.job';
import { PostProjectDealJob } from 'src/modules/enso/lead-pipeline/jobs/post-project-deal.job';
import { RecordActivityAttributionJob } from 'src/modules/enso/lead-pipeline/jobs/record-activity-attribution.job';
import { RouteOpportunityJob } from 'src/modules/enso/lead-pipeline/jobs/route-opportunity.job';
import {
  coerceTrafficType,
  SYSTEM_ACTOR,
} from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';
import {
  OpportunityResolutionService,
  type ResolutionResult,
} from 'src/modules/enso/lead-pipeline/services/opportunity-resolution.service';
import {
  type EnsoCreateManualLeadInput,
  type EnsoManualLeadResultDTO,
} from 'src/modules/enso/manual-lead/dtos/manual-lead.dto';
import {
  MANUAL_ENTRY_ACTIVITY_KIND,
  MANUAL_ENTRY_ACTIVITY_SOURCE,
  MANUAL_LEAD_FIRST_CONTACT_STEP_KEY,
} from 'src/modules/enso/manual-lead/manual-lead.constants';
import { ManualLeadDuplicateService } from 'src/modules/enso/manual-lead/services/manual-lead-duplicate.service';
import {
  type ManualLeadPlan,
  planManualLead,
} from 'src/modules/enso/manual-lead/utils/plan-manual-lead.util';
import { buildOwnerName } from 'src/modules/enso/record-lookup/utils/enso-lead-projection.util';
import { EnsoPostHogService } from 'src/modules/enso/routing-availability/services/enso-posthog.service';
import { toE164 } from 'src/modules/enso/shared/utils/person-phone.util';
import { buildPersonPhones } from 'src/modules/enso/telephony/utils/build-person-phones.util';

type ManualLeadSourceRow = {
  id: string;
  name?: string | null;
  category?: string | null;
  trafficType?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  isActive?: boolean | null;
  projectId?: string | null;
};

type Actor = {
  source: string;
  name: string;
  workspaceMemberId: string;
  context: Record<string, never>;
};

const failure = (error: string): EnsoManualLeadResultDTO => ({
  success: false,
  error,
  personId: null,
  opportunityId: null,
  activityId: null,
  isNewDeal: false,
  isNewPerson: false,
});

const richText = (lines: string[]) => ({
  markdown: lines.join('\n\n'),
  blocknote: JSON.stringify(
    lines.map((text, index) => ({
      id: `blk-${index}`,
      type: 'paragraph',
      props: {
        textColor: 'default',
        backgroundColor: 'default',
        textAlignment: 'left',
      },
      content: [{ type: 'text', text, styles: {} }],
      children: [],
    })),
  ),
});

// Adds a lead a manager found themselves. It goes in the way every other lead
// does — an inbound activity that attribution, first touch, timeline, consent
// and deal resolution all run on — so a hand-added lead is indistinguishable
// downstream except for being marked self-reported. What differs is only where
// its deal starts: with the manager who found it, with a colleague they chose,
// or in routing.
@Injectable()
export class ManualLeadService {
  private readonly logger = new Logger(ManualLeadService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly manualLeadDuplicateService: ManualLeadDuplicateService,
    private readonly opportunityResolutionService: OpportunityResolutionService,
    private readonly inboundActivityNameService: InboundActivityNameService,
    private readonly ensoPostHogService: EnsoPostHogService,
    @InjectMessageQueue(MessageQueue.ensoLeadPipelineQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {}

  async create({
    workspaceId,
    workspaceMemberId,
    input,
  }: {
    workspaceId: string;
    workspaceMemberId: string;
    input: EnsoCreateManualLeadInput;
  }): Promise<EnsoManualLeadResultDTO> {
    const requestKey = `manual-lead:${input.requestId}`;
    const systemAuthContext = buildSystemAuthContext(workspaceId);

    const previous = await this.findPreviousSubmission(workspaceId, requestKey);

    if (isDefined(previous)) {
      return {
        success: true,
        error: null,
        personId: previous.personId ?? null,
        opportunityId: previous.opportunityId ?? null,
        activityId: previous.id,
        isNewDeal: false,
        isNewPerson: false,
      };
    }

    const reference = await this.loadReferenceData(workspaceId, {
      projectId: input.projectId,
      manualLeadSourceId: input.manualLeadSourceId,
      creatorMemberId: workspaceMemberId,
      colleagueMemberId: input.colleagueWorkspaceMemberId,
    });

    if (!isDefined(reference.projectId)) {
      return failure('That project no longer exists.');
    }

    const source = reference.source;

    if (
      !isDefined(source) ||
      source.isActive === false ||
      (isDefined(source.projectId) && source.projectId !== input.projectId)
    ) {
      return failure(
        'Choose where this lead came from again — that source is no longer offered for this project.',
      );
    }

    if (
      input.destination === 'COLLEAGUE' &&
      !isDefined(reference.colleagueName)
    ) {
      return failure('That colleague is not a member of this workspace.');
    }

    const planned = planManualLead(input, {
      viewerWorkspaceMemberId: workspaceMemberId,
      sourceCategory: source.category ?? null,
      now: new Date(),
    });

    if (!planned.ok) {
      return failure(planned.error);
    }

    const plan = planned.plan;

    const { verdict } = await this.manualLeadDuplicateService.evaluate(
      {
        workspaceId,
        projectId: input.projectId,
        phoneNumber: input.phoneNumber,
        phoneCallingCode: input.phoneCallingCode,
        email: input.email,
      },
      workspaceMemberId,
    );

    if (verdict.verdict === 'BLOCKED') {
      const ownerName = await this.manualLeadDuplicateService.findOwnerName(
        workspaceId,
        verdict.ownerMemberId,
      );

      return failure(
        `${ownerName ?? 'A colleague'} already works with this client on this project, so the lead stays with them. Talk to them before adding it again.`,
      );
    }

    const actor: Actor = {
      source: 'MANUAL',
      name: reference.creatorName ?? 'ENSO CRM',
      workspaceMemberId,
      context: {},
    };

    const occurredAt = input.occurredAt ?? new Date();

    const personId =
      verdict.verdict === 'REUSE'
        ? await this.completeExistingPerson(
            workspaceId,
            verdict.personId,
            input,
          )
        : await this.createPerson(workspaceId, input, actor);

    if (!isDefined(personId)) {
      return failure(
        'The phone number could not be read. Check it and try again.',
      );
    }

    const activityId = await this.createActivity(workspaceId, {
      input,
      source,
      personId,
      occurredAt,
      requestKey,
      plan,
      actor,
    });

    // Attribution is a property of the activity, recorded whatever happens to
    // the deal — the same job every other inbound activity gets.
    await this.messageQueueService.add<RecordActivityAttributionJobData>(
      RecordActivityAttributionJob.name,
      { workspaceId, activityId },
      { id: `enso-activity-attribution:${activityId}` },
    );

    const resolution =
      await this.opportunityResolutionService.resolveFromActivity(
        systemAuthContext,
        activityId,
        isDefined(plan.ownerMemberId)
          ? {
              initialState: {
                stage: plan.stage,
                ownerMemberId: plan.ownerMemberId,
                firstContactAt: plan.firstContactAt?.toISOString() ?? null,
                firstContactChannel: plan.firstContactChannel,
              },
            }
          : undefined,
      );

    if (isDefined(resolution)) {
      await this.followUp(workspaceId, {
        resolution,
        plan,
        personId,
        creatorName: reference.creatorName,
      });
    }

    this.ensoPostHogService.capture({
      event: 'manual_lead_created',
      distinctId: workspaceMemberId,
      properties: {
        workspaceId,
        projectId: input.projectId,
        sourceCategory: source.category ?? null,
        destination: plan.destination,
        startStage: plan.stage,
        isNewPerson: verdict.verdict === 'NEW',
        isNewDeal: resolution?.created ?? false,
        verbalConsentChannelCount: input.verbalConsentChannels?.length ?? 0,
      },
    });

    return {
      success: true,
      error: null,
      personId,
      opportunityId: resolution?.opportunityId ?? null,
      activityId,
      isNewDeal: resolution?.created ?? false,
      isNewPerson: verdict.verdict === 'NEW',
    };
  }

  // What the pipeline would otherwise do after a deal is opened or claimed.
  private async followUp(
    workspaceId: string,
    {
      resolution,
      plan,
      personId,
      creatorName,
    }: {
      resolution: ResolutionResult;
      plan: ManualLeadPlan;
      personId: string;
      creatorName: string | null;
    },
  ): Promise<void> {
    const { opportunityId, created } = resolution;

    if (created) {
      await this.messageQueueService.add<PostProjectDealJobData>(
        PostProjectDealJob.name,
        { workspaceId, opportunityId },
        { id: `enso-project-deal-post:${opportunityId}:1` },
      );
    }

    if (plan.destination === 'ROUTING') {
      if (created) {
        await this.messageQueueService.add<RouteOpportunityJobData>(
          RouteOpportunityJob.name,
          { workspaceId, opportunityId, excludedManagerIds: [], attempt: 0 },
        );
      }

      return;
    }

    // Joining a deal that someone was already working changes nothing about
    // who works it; only a deal this lead opened or claimed out of routing does.
    const isNowOwnedFromThisLead =
      created || resolution.previousStage === 'ROUTING';

    if (!isNowOwnedFromThisLead || !isDefined(plan.ownerMemberId)) {
      return;
    }

    if (plan.stage === 'LEAD_CLAIMED') {
      await this.createFirstContactTask(workspaceId, {
        opportunityId,
        personId,
        ownerMemberId: plan.ownerMemberId,
      });
    }

    if (plan.destination === 'COLLEAGUE') {
      await this.messageQueueService.add<NotifyManagerAssignmentJobData>(
        NotifyManagerAssignmentJob.name,
        {
          workspaceId,
          opportunityId,
          managerId: plan.ownerMemberId,
          autoClaimed: true,
          handedOverByName: creatorName ?? undefined,
        },
      );
    }
  }

  private async findPreviousSubmission(
    workspaceId: string,
    requestKey: string,
  ): Promise<{
    id: string;
    personId?: string | null;
    opportunityId?: string | null;
  } | null> {
    return this.withRepositories(workspaceId, async (getRepository) => {
      const activityRepository = await getRepository('inboundActivity');

      return activityRepository.findOne({
        where: { sourceExternalId: requestKey },
      });
    });
  }

  private async loadReferenceData(
    workspaceId: string,
    ids: {
      projectId: string;
      manualLeadSourceId: string;
      creatorMemberId: string;
      colleagueMemberId?: string | null;
    },
  ): Promise<{
    projectId: string | null;
    source: ManualLeadSourceRow | null;
    creatorName: string | null;
    colleagueName: string | null;
  }> {
    return this.withRepositories(workspaceId, async (getRepository) => {
      const projectRepository = await getRepository('project');
      const sourceRepository = await getRepository('manualLeadSource');
      const memberRepository = await getRepository('workspaceMember');

      const [project, source, creator, colleague] = await Promise.all([
        projectRepository.findOne({ where: { id: ids.projectId } }),
        sourceRepository.findOne({ where: { id: ids.manualLeadSourceId } }),
        memberRepository.findOne({ where: { id: ids.creatorMemberId } }),
        isNonEmptyString(ids.colleagueMemberId)
          ? memberRepository.findOne({ where: { id: ids.colleagueMemberId } })
          : Promise.resolve(null),
      ]);

      return {
        projectId: project?.id ?? null,
        source: source ?? null,
        creatorName: buildOwnerName(creator),
        colleagueName: isDefined(colleague)
          ? (buildOwnerName(colleague) ?? 'a colleague')
          : null,
      };
    });
  }

  private async createPerson(
    workspaceId: string,
    input: EnsoCreateManualLeadInput,
    actor: Actor,
  ): Promise<string | null> {
    const phones = this.buildPhones(input);

    if (isNonEmptyString(input.phoneNumber) && !isDefined(phones)) {
      return null;
    }

    return this.withRepositories(workspaceId, async (getRepository) => {
      const personRepository = await getRepository('person');
      const id = randomUUID();
      const lastPosition = await personRepository.maximum(
        'position',
        undefined,
      );

      // Raw insert: the merge and company-link jobs that a UI-created contact
      // would trigger are not needed — the duplicate check already ran, and a
      // personal phone carries no company.
      await personRepository.insert({
        id,
        name: {
          firstName: input.firstName.trim(),
          lastName: input.lastName?.trim() ?? '',
        },
        ...(isDefined(phones) ? { phones } : {}),
        ...(isNonEmptyString(input.email)
          ? { emails: { primaryEmail: input.email.trim().toLowerCase() } }
          : {}),
        position: (lastPosition ?? 0) + 1,
        createdBy: actor,
        updatedBy: actor,
      });

      return id;
    });
  }

  // An existing contact keeps everything it has; the lead only fills a phone or
  // email it was missing.
  private async completeExistingPerson(
    workspaceId: string,
    personId: string,
    input: EnsoCreateManualLeadInput,
  ): Promise<string> {
    await this.withRepositories(workspaceId, async (getRepository) => {
      const personRepository = await getRepository('person');
      const person = await personRepository.findOne({
        where: { id: personId },
      });

      if (!isDefined(person)) {
        return;
      }

      const phones = this.buildPhones(input);
      const update: Record<string, unknown> = {};

      if (
        isDefined(phones) &&
        !isNonEmptyString(person.phones?.primaryPhoneNumber)
      ) {
        update.phones = { ...person.phones, ...phones };
      }

      if (
        isNonEmptyString(input.email) &&
        !isNonEmptyString(person.emails?.primaryEmail)
      ) {
        update.emails = {
          ...person.emails,
          primaryEmail: input.email.trim().toLowerCase(),
        };
      }

      if (Object.keys(update).length > 0) {
        await personRepository.update(
          { id: personId },
          { ...update, updatedBy: SYSTEM_ACTOR },
        );
      }
    });

    return personId;
  }

  private async createActivity(
    workspaceId: string,
    {
      input,
      source,
      personId,
      occurredAt,
      requestKey,
      plan,
      actor,
    }: {
      input: EnsoCreateManualLeadInput;
      source: ManualLeadSourceRow;
      personId: string;
      occurredAt: Date;
      requestKey: string;
      plan: ManualLeadPlan;
      actor: Actor;
    },
  ): Promise<string> {
    const id = randomUUID();

    const name = await this.inboundActivityNameService.computeName(
      buildSystemAuthContext(workspaceId),
      {
        kind: MANUAL_ENTRY_ACTIVITY_KIND,
        personId,
        projectId: input.projectId,
        occurredAt,
      },
    );

    await this.withRepositories(workspaceId, async (getRepository) => {
      const activityRepository = await getRepository('inboundActivity');
      const lastPosition = await activityRepository.maximum(
        'position',
        undefined,
      );

      await activityRepository.insert({
        id,
        ...(isDefined(name) ? { name } : {}),
        kind: MANUAL_ENTRY_ACTIVITY_KIND,
        source: MANUAL_ENTRY_ACTIVITY_SOURCE,
        status: 'PROCESSED',
        personId,
        projectId: input.projectId,
        occurredAt: occurredAt.toISOString(),
        ingestedAt: new Date().toISOString(),
        sourceExternalId: requestKey,
        isSelfReported: true,
        enteredById: actor.workspaceMemberId,
        manualLeadSourceId: source.id,
        referredByPersonId: input.referredByPersonId ?? null,
        referredByCompanyId: input.referredByCompanyId ?? null,
        referredByName: input.referredByName?.trim() || null,
        // Tracking values come from the source marketing defined, never from
        // the manager, so reports stay in marketing's own taxonomy.
        trafficType: coerceTrafficType(source.trafficType),
        utmSource: source.utmSource || null,
        utmMedium:
          (canonicalizeUtmMedium(source.utmMedium) as string | null) || null,
        utmCampaign: source.utmCampaign || null,
        body: input.note?.trim() || null,
        submittedPayload: {
          manualEntry: {
            verbalConsentChannels: input.verbalConsentChannels ?? [],
            destination: plan.destination,
            startStage: plan.stage,
          },
        },
        position: (lastPosition ?? 0) + 1,
        createdBy: actor,
        updatedBy: actor,
      });
    });

    return id;
  }

  private async createFirstContactTask(
    workspaceId: string,
    {
      opportunityId,
      personId,
      ownerMemberId,
    }: { opportunityId: string; personId: string; ownerMemberId: string },
  ): Promise<void> {
    try {
      await this.withRepositories(workspaceId, async (getRepository) => {
        const taskRepository = await getRepository('task');
        const taskTargetRepository = await getRepository('taskTarget');
        const personRepository = await getRepository('person');

        const person = await personRepository.findOne({
          where: { id: personId },
        });
        const hasPhone = isNonEmptyString(person?.phones?.primaryPhoneNumber);
        const contactName =
          [person?.name?.firstName, person?.name?.lastName]
            .filter(isNonEmptyString)
            .join(' ') || 'the new lead';

        const taskId = randomUUID();
        const lastPosition = await taskRepository.maximum(
          'position',
          undefined,
        );

        await taskRepository.insert({
          id: taskId,
          position: (lastPosition ?? 0) + 1,
          createdBy: SYSTEM_ACTOR,
          updatedBy: SYSTEM_ACTOR,
          title: `First contact with ${contactName}`,
          status: 'TODO',
          ...(hasPhone ? { channel: 'CALL' } : {}),
          stepKey: MANUAL_LEAD_FIRST_CONTACT_STEP_KEY,
          isAutoCreated: true,
          assigneeId: ownerMemberId,
          dueAt: new Date(),
          bodyV2: richText([
            `${contactName} was added by hand and nobody has spoken to them yet.`,
            'Reach out today. Once you have talked, the deal moves to Connected.',
          ]),
        });

        await taskTargetRepository.insert([
          {
            id: randomUUID(),
            taskId,
            targetOpportunityId: opportunityId,
            createdBy: SYSTEM_ACTOR,
            updatedBy: SYSTEM_ACTOR,
          },
          {
            id: randomUUID(),
            taskId,
            targetPersonId: personId,
            createdBy: SYSTEM_ACTOR,
            updatedBy: SYSTEM_ACTOR,
          },
        ]);
      });
    } catch (error) {
      // The lead and its deal are in; a missing reminder must not undo that.
      this.logger.warn(
        `First contact task failed for deal ${opportunityId}: ${(error as Error).message}`,
      );
    }
  }

  private buildPhones(input: EnsoCreateManualLeadInput) {
    const e164 = toE164(input.phoneCallingCode, input.phoneNumber);

    return isNonEmptyString(e164) ? buildPersonPhones(e164) : undefined;
  }

  private withRepositories<TResult>(
    workspaceId: string,
    callback: (
      getRepository: (objectNameSingular: string) => Promise<any>,
    ) => Promise<TResult>,
  ): Promise<TResult> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      () =>
        callback((objectNameSingular) =>
          this.globalWorkspaceOrmManager.getRepository<any>(
            workspaceId,
            objectNameSingular,
            { shouldBypassPermissionChecks: true },
          ),
        ),
      buildSystemAuthContext(workspaceId),
    );
  }
}
