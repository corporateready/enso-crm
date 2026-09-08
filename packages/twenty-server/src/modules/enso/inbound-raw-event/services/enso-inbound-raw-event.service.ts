import { Injectable, Logger } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import {
  type InboundRawEventChannel,
  type InboundRawEventStatus,
} from 'src/modules/enso/inbound-raw-event/types/inbound-raw-event.types';

// Raw inserts bypass the create resolver that normally fills the `createdBy`
// ACTOR from auth context, and `createdByName` / `updatedByName` are NOT NULL
// on custom objects. These rows are written by the system, so stamp them as a
// SYSTEM actor — without this every insert fails the NOT NULL constraint, and
// the ORM reports it only as the generic "Data validation error."
const SYSTEM_ACTOR = {
  source: 'SYSTEM',
  name: 'ENSO CRM',
  context: {},
} as const;

type InboundRawEventRow = {
  id: string;
  name?: string | null;
  channel?: string | null;
  source?: string | null;
  externalId?: string | null;
  occurredAt?: Date | null;
  payload?: unknown;
  processingStatus?: string | null;
  processingNote?: string | null;
  createdBy?: typeof SYSTEM_ACTOR;
  updatedBy?: typeof SYSTEM_ACTOR;
};

// The raw intake log.
//
// Every inbound webhook the CRM owns is acked with 200 and then normalized. A
// push that fails to normalize, or carries an unrecognised `cmd`, used to be
// acked and forgotten — no record, nothing to replay, no way to notice. Same
// class of failure as the calls pipeline severed at one node.
//
// So the body is written down BEFORE anything interprets it, and the outcome is
// stamped on afterwards. Nothing that reached us is lost, a bad batch can be
// replayed, and reconciliation gets a denominator that does not depend on the
// CRM's own logic having worked.
//
// EVERY method here is best-effort and swallows its own errors. These endpoints
// sit on live-call paths — the PBX `contact` push fires while the phone is
// ringing — so logging must never delay or fail a response. A lost log line is
// regrettable; a delayed ringing call is not acceptable.
// The ORM maps most Postgres failures to the message "Data validation error."
// and drops the detail, which made a NOT NULL violation on this object look
// like a payload problem for 25 minutes. Pull whatever the exception still
// carries so the log names the actual cause.
const describeError = (error: unknown): string => {
  const { message, code, detail, constraint } = (error ?? {}) as {
    message?: string;
    code?: string;
    detail?: string;
    constraint?: string;
  };

  return [
    message,
    code && `code=${code}`,
    constraint && `constraint=${constraint}`,
    detail,
  ]
    .filter(isNonEmptyString)
    .join(' ');
};

@Injectable()
export class EnsoInboundRawEventService {
  private readonly logger = new Logger(EnsoInboundRawEventService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  // Returns the row id so the caller can stamp an outcome on it, or undefined
  // if logging failed — callers must treat undefined as "carry on regardless".
  async record({
    workspaceId,
    channel,
    source,
    externalId,
    occurredAt,
    payload,
  }: {
    workspaceId: string;
    channel: InboundRawEventChannel;
    source: string;
    externalId?: string;
    occurredAt?: Date;
    payload: unknown;
  }): Promise<string | undefined> {
    try {
      return await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const repository =
            await this.globalWorkspaceOrmManager.getRepository<InboundRawEventRow>(
              workspaceId,
              'inboundRawEvent',
              { shouldBypassPermissionChecks: true },
            );

          const created = await repository.save({
            // The label identifier is what a human sees in a list, so make it
            // say what arrived rather than showing a bare uuid.
            name: [source, externalId].filter(isDefined).join(' · '),
            channel,
            source,
            externalId: externalId ?? null,
            occurredAt: occurredAt ?? null,
            payload,
            processingStatus: 'RECEIVED' satisfies InboundRawEventStatus,
            createdBy: SYSTEM_ACTOR,
            updatedBy: SYSTEM_ACTOR,
          });

          return created.id;
        },
        buildSystemAuthContext(workspaceId),
      );
    } catch (error) {
      this.logger.warn(
        `Could not record raw ${channel} payload: ${describeError(error)}`,
      );

      return undefined;
    }
  }

  async markOutcome({
    workspaceId,
    id,
    status,
    note,
  }: {
    workspaceId: string;
    id: string | undefined;
    status: InboundRawEventStatus;
    note?: string;
  }): Promise<void> {
    if (!isDefined(id)) {
      return;
    }

    try {
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const repository =
            await this.globalWorkspaceOrmManager.getRepository<InboundRawEventRow>(
              workspaceId,
              'inboundRawEvent',
              { shouldBypassPermissionChecks: true },
            );

          await repository.update(id, {
            processingStatus: status,
            ...(isDefined(note) ? { processingNote: note.slice(0, 500) } : {}),
          });
        },
        buildSystemAuthContext(workspaceId),
      );
    } catch (error) {
      this.logger.warn(
        `Could not stamp outcome ${status} on raw event ${id}: ${describeError(error)}`,
      );
    }
  }
}
