import { Injectable, Logger } from '@nestjs/common';

import { randomUUID } from 'crypto';

import { isDefined } from 'twenty-shared/utils';
import { IsNull, MoreThan } from 'typeorm';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { SYSTEM_ACTOR } from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';
import {
  buildEnsoTimelineInserts,
  type EnsoTimelineSegment,
} from 'src/modules/enso/timeline/enso-timeline.util';
import {
  CALL_STATUS_TO_OUTBOUND_OUTCOME,
  CRM_INITIATED_ADOPTION_WINDOW_MS,
} from 'src/modules/enso/telephony/telephony.constants';
import { type NormalizedCallEvent } from 'src/modules/enso/telephony/types/telephony.types';

// Inbound-activity object metadata id (single prod workspace). Used as the
// linkedObjectMetadataId on every enso-event row so they share the green ENSO
// icon (the icon is decorative — no record link needed).
const INBOUND_ACTIVITY_OBJECT_METADATA_ID =
  'cef40992-41c4-4742-8b4c-234777a1b8c6';

type ActorValue = { source: string; name: string; context?: object };

// Every outboundActivity column the outbound call leg reads or writes. Stands in
// for the entity class a custom object does not have, so a mistyped column name
// fails to compile instead of silently doing nothing.
export type OutboundActivityRow = {
  id: string;
  name?: string | null;
  channel?: string | null;
  loggedVia?: string | null;
  outcome?: string | null;
  body?: string | null;
  fromIdentity?: string | null;
  toIdentity?: string | null;
  externalId?: string | null;
  durationS?: number | null;
  // TEXT on outboundActivity — NOT the LINKS composite inboundActivity uses.
  recordingUrl?: string | null;
  occurredAt?: Date | string | null;
  position: number;
  createdBy?: ActorValue | null;
  updatedBy?: ActorValue | null;
  personId?: string | null;
  opportunityId?: string | null;
  taskId?: string | null;
  performedById?: string | null;
};

type OutboundActivityRepository = WorkspaceRepository<OutboundActivityRow>;

export type OutboundCallIngestResult = {
  activityId: string;
  created: boolean;
  // True only for the ONE push that first gave the row its outcome. The deal
  // link and the timeline line hang off this, so a redelivered `history` push
  // cannot produce a second timeline row for the same call.
  becameTerminal: boolean;
};

// The outbound half of PBX intake.
//
// Everything that goes through the PBX is observable whatever placed it — the
// CRM's own makeCall button, the Moldcell mobile app, a desk phone, a softphone.
// The pushes are the same `event`/`history` commands as inbound, only with
// `type=out`, and we were deliberately dropping them. This writes them as
// `outboundActivity` rows instead: a real touch on the contact, with duration,
// recording and the manager who placed it.
//
// An outbound call NEVER enters the lead pipeline. A manager dialling a number
// is not a new lead, and creating a Person for whoever they called would put
// junk in the CRM — so the contact is looked up, never created.
@Injectable()
export class OutboundCallIngestService {
  private readonly logger = new Logger(OutboundCallIngestService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  // Create on the first push of an outbound call, patch on the later ones — the
  // same create-early/patch-later shape as the inbound leg, because OUTGOING
  // fires as the call is placed and only `history` knows how it went.
  async ingest(
    workspaceId: string,
    event: NormalizedCallEvent,
    identity: { personId?: string; performedById?: string },
  ): Promise<OutboundCallIngestResult | undefined> {
    const systemAuthContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository = await this.getRepository(workspaceId);

        const existing = await this.findCorrelatedActivity(
          repository,
          event,
          identity.performedById,
        );

        if (isDefined(existing)) {
          const hadOutcome =
            isDefined(existing.outcome) || isDefined(existing.durationS);

          await this.patchActivity(repository, existing, event, identity);

          return {
            activityId: existing.id,
            created: false,
            becameTerminal: !hadOutcome && event.isAuthoritativeOutcome,
          };
        }

        const activityId = await this.createActivity(
          repository,
          event,
          identity,
        );

        return {
          activityId,
          created: true,
          becameTerminal: event.isAuthoritativeOutcome,
        };
      },
      systemAuthContext,
    );
  }

  // Two lookups, in order of certainty.
  //
  // 1. The PBX call id, which makes a redelivered push a no-op.
  // 2. A row this CRM created moments ago by pressing "Call via PBX". makeCall
  //    answers with its own CallID and there is no documented guarantee that it
  //    equals the `callid` on the pushes, so a CRM-initiated row is adopted on
  //    (manager, remote number, recent, still has no duration) and takes over the
  //    push's id. Without this the manager's own click and the call it produced
  //    would be logged twice.
  private async findCorrelatedActivity(
    repository: OutboundActivityRepository,
    event: NormalizedCallEvent,
    performedById: string | undefined,
  ): Promise<OutboundActivityRow | undefined> {
    const byExternalId = await repository.findOne({
      where: { externalId: event.externalId },
    });

    if (isDefined(byExternalId)) {
      return byExternalId;
    }

    if (!isDefined(event.callerE164) || !isDefined(performedById)) {
      return undefined;
    }

    const since = new Date(Date.now() - CRM_INITIATED_ADOPTION_WINDOW_MS);

    const candidates = await repository.find({
      where: {
        channel: 'CALL',
        loggedVia: 'CRM_INITIATED',
        performedById,
        toIdentity: event.callerE164,
        durationS: IsNull(),
        occurredAt: MoreThan(since),
      },
    });

    if (candidates.length === 0) {
      return undefined;
    }

    // Most recent first: if a manager pressed the button twice, the later click
    // is the one this call belongs to.
    return candidates
      .slice()
      .sort(
        (left, right) =>
          new Date(right.occurredAt ?? 0).getTime() -
          new Date(left.occurredAt ?? 0).getTime(),
      )[0];
  }

  private async createActivity(
    repository: OutboundActivityRepository,
    event: NormalizedCallEvent,
    identity: { personId?: string; performedById?: string },
  ): Promise<string> {
    const id = randomUUID();
    const occurredAt = event.occurredAt ?? new Date();
    const lastPosition = await repository.maximum('position', undefined);

    await repository.insert({
      id,
      name: this.buildName(event, occurredAt),
      channel: 'CALL',
      // Placed outside the CRM (the Moldcell app, a desk phone, a softphone) but
      // still fully captured by the PBX. Distinct from CRM_INITIATED, which means
      // a manager pressed a button here, and from MANUAL_LOG, which means the
      // call happened somewhere we cannot see and a human typed it in.
      loggedVia: 'OBSERVED',
      externalId: event.externalId,
      toIdentity: event.callerE164 ?? null,
      fromIdentity: this.buildFromIdentity(event),
      occurredAt,
      ...this.outcomeFields(event),
      ...(isDefined(identity.personId) ? { personId: identity.personId } : {}),
      ...(isDefined(identity.performedById)
        ? { performedById: identity.performedById }
        : {}),
      position: (lastPosition ?? 0) + 1,
      createdBy: SYSTEM_ACTOR,
      updatedBy: SYSTEM_ACTOR,
    });

    this.logger.log(
      `Created outbound call activity ${id} (${event.externalId})`,
    );

    return id;
  }

  private async patchActivity(
    repository: OutboundActivityRepository,
    existing: OutboundActivityRow,
    event: NormalizedCallEvent,
    identity: { personId?: string; performedById?: string },
  ): Promise<void> {
    const patch: Record<string, unknown> = {
      ...this.outcomeFields(event),
      updatedBy: SYSTEM_ACTOR,
    };

    // A CRM-initiated row adopted on (manager, number, time) has no PBX id yet;
    // taking the push's id makes every later push about this call land here.
    if (existing.externalId !== event.externalId) {
      patch.externalId = event.externalId;
    }

    // Only an `event` push identifies the outcome-free start of the call, so a
    // non-authoritative push must not undo what `history` already established.
    if (!event.isAuthoritativeOutcome) {
      if (isDefined(existing.outcome)) {
        delete patch.outcome;
      }

      if (isDefined(existing.durationS)) {
        delete patch.durationS;
      }
    }

    // The manager pressing the button is the truth about how the touch was
    // logged; an observed push must not downgrade it.
    if (!isDefined(existing.loggedVia)) {
      patch.loggedVia = 'OBSERVED';
    }

    if (!isDefined(existing.personId) && isDefined(identity.personId)) {
      patch.personId = identity.personId;
    }

    if (
      !isDefined(existing.performedById) &&
      isDefined(identity.performedById)
    ) {
      patch.performedById = identity.performedById;
    }

    if (!isDefined(existing.toIdentity) && isDefined(event.callerE164)) {
      patch.toIdentity = event.callerE164;
    }

    const fromIdentity = this.buildFromIdentity(event);

    if (!isDefined(existing.fromIdentity) && isDefined(fromIdentity)) {
      patch.fromIdentity = fromIdentity;
    }

    // Only `history` carries a real call-start timestamp; the OUTGOING push is
    // stamped with its own arrival time and COMPLETED carries none at all.
    if (event.isAuthoritativeOutcome && isDefined(event.occurredAt)) {
      patch.occurredAt = event.occurredAt;
    }

    // Same rule as the inbound patch builder: strip only `undefined`, because a
    // deliberate `null` is how a column gets cleared.
    for (const key of Object.keys(patch)) {
      if (patch[key] === undefined) {
        delete patch[key];
      }
    }

    await repository.update({ id: existing.id }, patch);

    this.logger.log(
      `Patched outbound call activity ${existing.id} (${event.externalId})`,
    );
  }

  // Called once — from the push that first carried the outcome — to attach the
  // deal (when there is exactly one open one) and write the timeline line.
  async finalize(
    workspaceId: string,
    activityId: string,
    details: {
      personId?: string;
      opportunityId?: string;
      performedById?: string;
      durationS?: number;
      answered: boolean;
    },
  ): Promise<void> {
    const systemAuthContext = buildSystemAuthContext(workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository = await this.getRepository(workspaceId);
        const existing = await repository.findOne({
          where: { id: activityId },
        });

        if (!isDefined(existing)) {
          return;
        }

        if (
          !isDefined(existing.opportunityId) &&
          isDefined(details.opportunityId)
        ) {
          await repository.update(
            { id: activityId },
            { opportunityId: details.opportunityId, updatedBy: SYSTEM_ACTOR },
          );
        }

        await this.writeTimeline(workspaceId, existing, {
          ...details,
          opportunityId: details.opportunityId ?? existing.opportunityId,
        });
      },
      systemAuthContext,
    );
  }

  // One row per timeline the call should appear on. Written explicitly rather
  // than left to record-create events, which cannot phrase "called them,
  // connected, 41 s, recorded". Best-effort: a timeline miss must never fail
  // ingest, which is what actually records the call.
  private async writeTimeline(
    workspaceId: string,
    existing: OutboundActivityRow,
    details: {
      personId?: string;
      opportunityId?: string | null;
      performedById?: string;
      durationS?: number;
      answered: boolean;
    },
  ): Promise<void> {
    try {
      const inserts = buildEnsoTimelineInserts({
        action: 'outbound-call',
        target: {
          personId: details.personId ?? existing.personId ?? null,
          opportunityId: details.opportunityId ?? null,
        },
        segments: this.buildTimelineSegments(existing, details),
        // Attributed to the manager when their PBX login maps to a member;
        // otherwise it reads "by ENSO CRM", which is honest — we observed the
        // call without being able to say whose it was.
        ...(isDefined(details.performedById)
          ? { workspaceMemberId: details.performedById }
          : { auto: true }),
        linkedObjectMetadataId: INBOUND_ACTIVITY_OBJECT_METADATA_ID,
        ...(isDefined(existing.occurredAt)
          ? { happensAt: new Date(existing.occurredAt).toISOString() }
          : {}),
      });

      if (inserts.length === 0) {
        return;
      }

      const timelineRepository =
        await this.globalWorkspaceOrmManager.getRepository<
          Record<string, unknown>
        >(workspaceId, 'timelineActivity', {
          shouldBypassPermissionChecks: true,
        });

      await timelineRepository.insert(inserts);
    } catch (error) {
      this.logger.warn(
        `outbound-call timeline write failed for ${existing.id}: ${(error as Error).message}`,
      );
    }
  }

  private buildTimelineSegments(
    existing: OutboundActivityRow,
    details: { durationS?: number; answered: boolean },
  ): EnsoTimelineSegment[] {
    const target = existing.toIdentity ?? 'an unknown number';
    const placedHere = existing.loggedVia === 'CRM_INITIATED';

    if (!details.answered) {
      return [
        {
          text: `Called ${target} — no answer${placedHere ? '' : ' (placed outside the CRM)'}`,
        },
      ];
    }

    const duration = isDefined(details.durationS)
      ? `, ${details.durationS} s`
      : '';
    const recorded = isDefined(existing.recordingUrl) ? ', recorded' : '';

    return [
      {
        text: `Called ${target} — connected${duration}${recorded}${placedHere ? '' : ' (placed outside the CRM)'}`,
      },
    ];
  }

  private outcomeFields(event: NormalizedCallEvent): Record<string, unknown> {
    const fields: Record<string, unknown> = {};

    if (isDefined(event.callStatus)) {
      const outcome = CALL_STATUS_TO_OUTBOUND_OUTCOME[event.callStatus];

      if (isDefined(outcome)) {
        fields.outcome = outcome;
      }
    }

    if (isDefined(event.durationS)) {
      fields.durationS = event.durationS;
    }

    if (isDefined(event.recordingUrl)) {
      fields.recordingUrl = event.recordingUrl;
    }

    return fields;
  }


  // The PBX side of the call: the manager's own direct number if the push names
  // one, otherwise their PBX login — enough for a human to see where it went out.
  private buildFromIdentity(event: NormalizedCallEvent): string | undefined {
    if (isDefined(event.pbxTelnum) && event.pbxTelnum) {
      return `+${event.pbxTelnum}`;
    }

    return isDefined(event.answeredByLogin) && event.answeredByLogin
      ? event.answeredByLogin
      : undefined;
  }

  // outboundActivity has no computed-label service, and rows written by the
  // action widget leave `name` empty. An observed call has nobody to type a
  // label, so give it a readable one rather than a blank row in the timeline.
  private buildName(event: NormalizedCallEvent, occurredAt: Date): string {
    const target = event.callerE164 ?? 'unknown number';
    const stamp = occurredAt.toISOString().slice(0, 16).replace('T', ' ');

    return `Outbound call · ${target} · ${stamp}`;
  }

  private async getRepository(
    workspaceId: string,
  ): Promise<OutboundActivityRepository> {
    return this.globalWorkspaceOrmManager.getRepository<OutboundActivityRow>(
      workspaceId,
      'outboundActivity',
      { shouldBypassPermissionChecks: true },
    );
  }
}
