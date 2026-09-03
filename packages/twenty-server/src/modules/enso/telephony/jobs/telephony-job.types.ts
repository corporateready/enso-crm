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

export type DecideCallOutcomeJobData = {
  workspaceId: string;
  activityId: string;
};

export type ArchiveCallRecordingJobData = {
  workspaceId: string;
  // The PBX url the audio is fetched from. Kept on the activity too, as
  // provenance for the archived copy.
  recordingUrl: string;
  objectNameSingular: 'inboundActivity' | 'outboundActivity';
  activityId: string;
  // Used only to label the attachment with the time of the call.
  occurredAtIso?: string;
  // 1-based. The PBX writes the recording after the call ends, so the first
  // attempt legitimately finds nothing; the job re-enqueues itself with a delay
  // until this hits RECORDING_FETCH_RETRIES.
  attempt?: number;
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
