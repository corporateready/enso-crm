import { type NormalizedCallEvent } from 'src/modules/enso/telephony/types/telephony.types';

// BullMQ payloads are JSON, so `occurredAt` cannot travel as a Date. Making the
// wire form explicit avoids the classic bug where a revived string is passed to
// something expecting a Date and silently becomes "Invalid Date".
export type SerializedCallEvent = Omit<NormalizedCallEvent, 'occurredAt'> & {
  occurredAtIso?: string;
};

export type IngestCallEventJobData = {
  workspaceId: string;
  event: SerializedCallEvent;
};

export const serializeCallEvent = (
  event: NormalizedCallEvent,
): SerializedCallEvent => {
  const { occurredAt, ...rest } = event;

  return {
    ...rest,
    ...(occurredAt ? { occurredAtIso: occurredAt.toISOString() } : {}),
  };
};

export const deserializeCallEvent = (
  event: SerializedCallEvent,
): NormalizedCallEvent => {
  const { occurredAtIso, ...rest } = event;

  if (!occurredAtIso) {
    return rest;
  }

  const parsed = new Date(occurredAtIso);

  return {
    ...rest,
    ...(Number.isNaN(parsed.getTime()) ? {} : { occurredAt: parsed }),
  };
};
