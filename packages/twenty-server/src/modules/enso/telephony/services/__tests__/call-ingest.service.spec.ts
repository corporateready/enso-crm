import { CallIngestService } from 'src/modules/enso/telephony/services/call-ingest.service';
import { type NormalizedCallEvent } from 'src/modules/enso/telephony/types/telephony.types';

// What the row says about a call WHILE IT IS STILL RUNNING.
//
// The pushes for one call race each other, and `event CANCELLED` is per-leg: an
// extension that stops ringing sends one whether or not anybody else answered.
// Live on 2026-09-17 — ext 708 CANCELLED at 11:26:46, ext 720 ACCEPTED at
// 11:26:49, `history` (Success, 98 sec) only at 11:28:33 — the row claimed
// ABANDONED for the entire 98-second conversation.

const EXTERNAL_ID = 'moldcell:LF4VGFF65C000036';

const baseEvent: NormalizedCallEvent = {
  externalId: EXTERNAL_ID,
  provider: 'moldcell',
  direction: 'in',
  eventKey: 'moldcell:event:INCOMING',
  isAuthoritativeOutcome: false,
  callerE164: '+37378447626',
  rawPayload: { callid: 'LF4VGFF65C000036' },
  isTerminal: false,
};

const cancelledEvent: NormalizedCallEvent = {
  ...baseEvent,
  eventKey: 'moldcell:event:CANCELLED',
  callStatus: 'ABANDONED',
  isTerminal: true,
};

const acceptedEvent: NormalizedCallEvent = {
  ...baseEvent,
  eventKey: 'moldcell:event:ACCEPTED',
  answeredByLogin: 'oleg_luchian',
};

const historyEvent: NormalizedCallEvent = {
  ...baseEvent,
  eventKey: 'moldcell:history',
  isAuthoritativeOutcome: true,
  callStatus: 'ANSWERED',
  durationS: 98,
  answeredByLogin: 'oleg_luchian',
  isTerminal: true,
};

type Row = Record<string, unknown>;

const buildService = (existing: Row) => {
  const repository = {
    findOne: jest.fn().mockResolvedValue(existing),
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(undefined),
    insert: jest.fn().mockResolvedValue(undefined),
    maximum: jest.fn().mockResolvedValue(1),
  };

  const globalWorkspaceOrmManager = {
    executeInWorkspaceContext: jest.fn((callback: () => unknown) => callback()),
    getRepository: jest.fn().mockResolvedValue(repository),
  };

  const inboundActivityNameService = {
    computeName: jest.fn().mockResolvedValue('Call'),
  };

  const service = new CallIngestService(
    globalWorkspaceOrmManager as never,
    inboundActivityNameService as never,
  );

  return { service, repository };
};

const patchFrom = (repository: { update: jest.Mock }) =>
  repository.update.mock.calls[0][1] as Row;

describe('CallIngestService status while a call is still running', () => {
  it('should replace a losing leg’s ABANDONED when an individual accepts', async () => {
    const { service, repository } = buildService({
      id: 'activity-id',
      sourceExternalId: EXTERNAL_ID,
      callStatus: 'ABANDONED',
      submittedPayload: { 'moldcell:event:CANCELLED': {} },
    });

    await service.ingest('workspace-id', acceptedEvent);

    expect(patchFrom(repository)).toMatchObject({
      callStatus: 'SALES_PICKUP',
      salesPickup: true,
    });
  });

  it('should not let a losing leg write off a call already picked up', async () => {
    const { service, repository } = buildService({
      id: 'activity-id',
      sourceExternalId: EXTERNAL_ID,
      callStatus: 'SALES_PICKUP',
      salesPickup: true,
      submittedPayload: { 'moldcell:event:ACCEPTED': {} },
    });

    await service.ingest('workspace-id', cancelledEvent);

    expect(patchFrom(repository).callStatus).toBeUndefined();
  });

  // Same guard, for a row whose pickup was recorded before this status existed.
  it('should not write ABANDONED over a pickup that carries no status', async () => {
    const { service, repository } = buildService({
      id: 'activity-id',
      sourceExternalId: EXTERNAL_ID,
      salesPickup: true,
      submittedPayload: {},
    });

    await service.ingest('workspace-id', cancelledEvent);

    expect(patchFrom(repository).callStatus).toBeUndefined();
  });

  it('should still record ABANDONED on a call nobody picked up', async () => {
    const { service, repository } = buildService({
      id: 'activity-id',
      sourceExternalId: EXTERNAL_ID,
      submittedPayload: {},
    });

    await service.ingest('workspace-id', cancelledEvent);

    expect(patchFrom(repository).callStatus).toBe('ABANDONED');
  });

  it('should let the closing push state the real outcome', async () => {
    const { service, repository } = buildService({
      id: 'activity-id',
      sourceExternalId: EXTERNAL_ID,
      callStatus: 'SALES_PICKUP',
      salesPickup: true,
      submittedPayload: { 'moldcell:event:ACCEPTED': {} },
    });

    await service.ingest('workspace-id', historyEvent);

    expect(patchFrom(repository)).toMatchObject({
      callStatus: 'ANSWERED',
      durationS: 98,
    });
  });

  it('should ignore a provisional push once the closing one has spoken', async () => {
    const { service, repository } = buildService({
      id: 'activity-id',
      sourceExternalId: EXTERNAL_ID,
      callStatus: 'ANSWERED',
      salesPickup: true,
      durationS: 98,
      submittedPayload: { 'moldcell:history': {} },
    });

    await service.ingest('workspace-id', cancelledEvent);

    expect(patchFrom(repository).callStatus).toBeUndefined();
  });
});
