import { Injectable, Logger } from '@nestjs/common';

import { randomUUID } from 'crypto';

import { isDefined } from 'twenty-shared/utils';
import { Between } from 'typeorm';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { InboundActivityNameService } from 'src/modules/enso/inbound-activity/services/inbound-activity-name.service';
import { SYSTEM_ACTOR } from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';
import {
  ANSWERED_CALL_STATUSES,
  CROSS_PROVIDER_CORRELATION_WINDOW_MS,
} from 'src/modules/enso/telephony/telephony.constants';
import { type NormalizedCallEvent } from 'src/modules/enso/telephony/types/telephony.types';

type InboundActivityRow = {
  id: string;
  sourceExternalId?: string | null;
  externalId?: string | null;
  callStatus?: string | null;
  durationS?: number | null;
  occurredAt?: Date | string | null;
  callerE164?: string | null;
  status?: string | null;
};

// `inboundActivity` is a workspace-metadata custom object, so there is no
// generated entity to type the repository against. Rather than passing `any`
// around, declare the narrow surface this service actually uses.
type InboundActivityRepository = {
  findOne(options: object): Promise<InboundActivityRow | null | undefined>;
  find(options: object): Promise<InboundActivityRow[]>;
  insert(entity: Record<string, unknown>): Promise<unknown>;
  update(
    criteria: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Promise<unknown>;
  maximum(field: string, criteria?: unknown): Promise<number | null>;
};

@Injectable()
export class CallIngestService {
  private readonly logger = new Logger(CallIngestService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly inboundActivityNameService: InboundActivityNameService,
  ) {}

  // Creates the activity on the first signal of a call and patches it as later
  // events arrive. Deliberately "create early, patch later": the PBX INCOMING
  // push lands while the phone is still ringing, so waiting for a terminal event
  // before writing anything is what made the legacy pipeline blind.
  async ingest(
    workspaceId: string,
    event: NormalizedCallEvent,
  ): Promise<{ activityId: string; created: boolean } | undefined> {
    const systemAuthContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository =
          await this.globalWorkspaceOrmManager.getRepository<InboundActivityRepository>(
            workspaceId,
            'inboundActivity',
            { shouldBypassPermissionChecks: true },
          );

        const existing = await this.findCorrelatedActivity(repository, event);

        if (isDefined(existing)) {
          await this.patchActivity(repository, existing, event);

          return { activityId: existing.id, created: false };
        }

        const activityId = await this.createActivity(
          repository,
          systemAuthContext,
          event,
        );

        return { activityId, created: true };
      },
      systemAuthContext,
    );
  }

  // Two-step lookup. First the provider's own id, which makes redelivery of the
  // same push a no-op. Then, for a provider we have not seen this call from yet,
  // a (caller, time-window) join — Roistat never sees the PBX `callid`, so this
  // is the only way to recognise that both providers are describing one call.
  private async findCorrelatedActivity(
    repository: InboundActivityRepository,
    event: NormalizedCallEvent,
  ): Promise<InboundActivityRow | undefined> {
    const byExternalId = await repository.findOne({
      where: [
        { sourceExternalId: event.externalId },
        { externalId: event.externalId },
      ],
    });

    if (isDefined(byExternalId)) {
      return byExternalId;
    }

    if (!isDefined(event.callerE164) || !isDefined(event.occurredAt)) {
      return undefined;
    }

    const from = new Date(
      event.occurredAt.getTime() - CROSS_PROVIDER_CORRELATION_WINDOW_MS,
    );
    const to = new Date(
      event.occurredAt.getTime() + CROSS_PROVIDER_CORRELATION_WINDOW_MS,
    );

    const candidates: InboundActivityRow[] = await repository.find({
      where: {
        kind: 'INCOMING_CALL',
        callerE164: event.callerE164,
        occurredAt: Between(from, to),
      },
    });

    // Only ever join ACROSS providers. A row that already carries an id from
    // this provider describes a different call by the same caller — the legacy
    // pipeline keyed purely on phone number and produced exactly this
    // cross-call contamination (one activity per phone per 20 minutes,
    // regardless of how many distinct calls).
    const joinable = candidates.filter(
      (candidate) => !this.hasProviderId(candidate, event.provider),
    );

    if (joinable.length === 0) {
      return undefined;
    }

    // The same caller can ring twice inside the window, so take the closest in
    // time rather than the first row the database happens to return.
    const target = event.occurredAt.getTime();

    return joinable
      .slice()
      .sort(
        (left, right) =>
          Math.abs(new Date(left.occurredAt ?? 0).getTime() - target) -
          Math.abs(new Date(right.occurredAt ?? 0).getTime() - target),
      )[0];
  }

  private hasProviderId(
    row: InboundActivityRow,
    provider: NormalizedCallEvent['provider'],
  ): boolean {
    const prefix = `${provider}:`;

    return (
      Boolean(row.sourceExternalId?.startsWith(prefix)) ||
      Boolean(row.externalId?.startsWith(prefix))
    );
  }

  private async createActivity(
    repository: InboundActivityRepository,
    systemAuthContext: ReturnType<typeof buildSystemAuthContext>,
    event: NormalizedCallEvent,
  ): Promise<string> {
    const id = randomUUID();
    const occurredAt = event.occurredAt ?? new Date();

    // Raw insert bypasses the create resolver, so the computed label, position
    // and actor columns have to be materialized here (same as the other
    // pipeline-side writes).
    const name = await this.inboundActivityNameService.computeName(
      systemAuthContext,
      {
        id,
        kind: 'INCOMING_CALL',
        occurredAt,
        callerE164: event.callerE164 ?? null,
      },
    );

    const lastPosition = await repository.maximum('position', undefined);

    await repository.insert({
      id,
      kind: 'INCOMING_CALL',
      sourceExternalId: event.externalId,
      callerE164: event.callerE164 ?? null,
      calleeDid: event.calleeDid ?? null,
      occurredAt,
      ingestedAt: new Date(),
      // NOT NULL columns with no useful value yet.
      isSynthetic: false,
      salesPickup: this.isIndividualPickup(event),
      status: event.isTerminal ? 'PROCESSED' : 'PENDING',
      ...this.outcomeFields(event),
      ...this.attributionFields(event),
      submittedPayload: event.rawPayload ?? null,
      position: (lastPosition ?? 0) + 1,
      createdBy: SYSTEM_ACTOR,
      updatedBy: SYSTEM_ACTOR,
      ...(isDefined(name) ? { name } : {}),
    });

    this.logger.log(
      `Created inbound call activity ${id} from ${event.provider} (${event.externalId})`,
    );

    return id;
  }

  private async patchActivity(
    repository: InboundActivityRepository,
    existing: InboundActivityRow,
    event: NormalizedCallEvent,
  ): Promise<void> {
    const outcome = this.outcomeFields(event);

    // A non-authoritative event (an `event` push, or the Roistat at-call slot)
    // must not overwrite an outcome the authoritative record already established
    // — otherwise a late-arriving CANCELLED would downgrade a call that history
    // already reported as Success.
    if (!event.isAuthoritativeOutcome) {
      if (isDefined(existing.callStatus)) {
        delete outcome.callStatus;
      }

      if (isDefined(existing.durationS)) {
        delete outcome.durationS;
      }
    }

    const patch: Record<string, unknown> = {
      ...outcome,
      ...this.attributionFields(event),
      updatedBy: SYSTEM_ACTOR,
    };

    // The PBX `callid` is authoritative, so when the PBX turns up for a call
    // Roistat told us about first, it takes over the correlation key and the
    // Roistat id moves to the secondary column. Keeping both means either
    // provider can redeliver without creating a duplicate.
    if (
      event.provider === 'moldcell' &&
      existing.sourceExternalId !== event.externalId
    ) {
      patch.sourceExternalId = event.externalId;

      if (isDefined(existing.sourceExternalId)) {
        patch.externalId = existing.sourceExternalId;
      }
    } else if (
      event.provider === 'roistat' &&
      existing.sourceExternalId !== event.externalId &&
      existing.externalId !== event.externalId
    ) {
      patch.externalId = event.externalId;
    }

    if (!isDefined(existing.callerE164) && isDefined(event.callerE164)) {
      patch.callerE164 = event.callerE164;
    }

    if (isDefined(event.calleeDid)) {
      patch.calleeDid = event.calleeDid;
    }

    // Only the authoritative record carries a real call-start timestamp. An
    // INCOMING push approximates it with its arrival time, and COMPLETED /
    // CANCELLED do not carry one at all — overwriting from those would move
    // occurredAt to the end of the call.
    if (event.isAuthoritativeOutcome && isDefined(event.occurredAt)) {
      patch.occurredAt = event.occurredAt;
    }

    if (this.isIndividualPickup(event)) {
      patch.salesPickup = true;
    }

    if (event.isTerminal) {
      patch.status = 'PROCESSED';
    }

    // Drop keys with no value so a later, sparser event cannot blank out data an
    // earlier one already established.
    for (const key of Object.keys(patch)) {
      if (!isDefined(patch[key])) {
        delete patch[key];
      }
    }

    await repository.update({ id: existing.id }, patch);

    this.logger.log(
      `Patched inbound call activity ${existing.id} from ${event.provider} (${event.externalId})`,
    );
  }

  // Whether an individual employee — not a department/IVR — took the call.
  // Verified against live PBX history: a group login, and even a real user
  // login, appears in the answered-by column for calls nobody picked up, so the
  // status has to agree as well.
  private isIndividualPickup(event: NormalizedCallEvent): boolean {
    if (!isDefined(event.answeredByLogin)) {
      return false;
    }

    if (!isDefined(event.callStatus)) {
      // ACCEPTED pushes name the person who answered but carry no status.
      return true;
    }

    return ANSWERED_CALL_STATUSES.includes(event.callStatus);
  }

  private outcomeFields(event: NormalizedCallEvent): Record<string, unknown> {
    const fields: Record<string, unknown> = {};

    if (isDefined(event.callStatus)) {
      fields.callStatus = event.callStatus;
    }

    if (isDefined(event.durationS)) {
      fields.durationS = event.durationS;
    }

    if (isDefined(event.recordingUrl)) {
      // recordingUrl is a LINKS composite, not a plain string.
      fields.recordingUrl = {
        primaryLinkUrl: event.recordingUrl,
        primaryLinkLabel: 'Recording',
        secondaryLinks: null,
      };
    }

    // Only a department answering is a "non-sales pickup"; an individual is
    // recorded via salesPickup instead.
    if (isDefined(event.answeredByGroup) && !isDefined(event.answeredByLogin)) {
      fields.nonSalesPickupBy = event.answeredByGroup;
    }

    return fields;
  }

  // Attribution only ever comes from Roistat — the PBX knows nothing about
  // campaigns. Present on both Roistat slots, including the at-call one.
  private attributionFields(
    event: NormalizedCallEvent,
  ): Record<string, unknown> {
    const attribution = event.attribution;

    if (!isDefined(attribution)) {
      return {};
    }

    const fields: Record<string, unknown> = {
      source: 'ROISTAT',
      roistatVisitId: attribution.roistatVisitId,
      utmSource: attribution.utmSource,
      utmMedium: attribution.utmMedium,
      utmCampaign: attribution.utmCampaign,
      utmContent: attribution.utmContent,
      utmTerm: attribution.utmTerm,
      landingPage: attribution.landingPage,
      referrer: attribution.referrer,
      googleClientId: attribution.googleClientId,
      ipAddress: attribution.ipAddress,
      city: attribution.city,
      country: attribution.country,
      fbclid: attribution.fbclid,
      fbp: attribution.fbp,
      distinctId: attribution.distinctId,
    };

    // Roistat omits most of these per scenario, and an absent key must not be
    // written as NULL over a value an earlier push already supplied.
    for (const key of Object.keys(fields)) {
      if (!isDefined(fields[key])) {
        delete fields[key];
      }
    }

    return fields;
  }
}
