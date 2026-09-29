import { type MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { type EnsoInboundRawEventService } from 'src/modules/enso/inbound-raw-event/services/enso-inbound-raw-event.service';
import { TelephonyController } from 'src/modules/enso/telephony/controllers/telephony.controller';
import { type TelephonyContactService } from 'src/modules/enso/telephony/services/telephony-contact.service';
import { CONTACT_RESPONSE_BUDGET_MS } from 'src/modules/enso/telephony/telephony.constants';

// The constants read env at module load: an unconfigured shared secret rejects
// every push, and an unset workspace id skips raw logging altogether.
jest.mock('src/modules/enso/telephony/telephony.constants', () => ({
  ...jest.requireActual('src/modules/enso/telephony/telephony.constants'),
  TELEPHONY_WORKSPACE_ID: 'workspace-1',
  MOLDCELL_CRM_TOKEN: 'crm-token',
  ROISTAT_WEBHOOK_SECRET: 'roistat-secret',
}));

const CRM_TOKEN = 'crm-token';

describe('TelephonyController raw intake logging', () => {
  let controller: TelephonyController;
  let record: jest.Mock;
  let markOutcome: jest.Mock;
  let annotate: jest.Mock;
  let add: jest.Mock;
  let resolveContact: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    record = jest.fn().mockResolvedValue('raw-event-1');
    markOutcome = jest.fn().mockResolvedValue(undefined);
    annotate = jest.fn().mockResolvedValue(undefined);
    add = jest.fn().mockResolvedValue(undefined);
    resolveContact = jest.fn().mockResolvedValue({});

    controller = new TelephonyController(
      { add } as unknown as MessageQueueService,
      { resolveContact } as unknown as TelephonyContactService,
      {
        record,
        markOutcome,
        annotate,
      } as unknown as EnsoInboundRawEventService,
    );
  });

  it('should record a contact push as NOT_TRACKED, because nothing ever stamps an outcome on it', async () => {
    await controller.moldcell({
      cmd: 'contact',
      crm_token: CRM_TOKEN,
      callid: 'call-1',
      phone: '37368879173',
    } as never);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'moldcell:contact',
        initialStatus: 'NOT_TRACKED',
      }),
    );
    // The whole point of the distinct status: this branch answers a ringing
    // call and never comes back to stamp, so a RECEIVED row here is permanent
    // and indistinguishable from a handler that died before stamping.
    expect(markOutcome).not.toHaveBeenCalled();
  });

  it('should leave an event push at the default RECEIVED and stamp its outcome', async () => {
    await controller.moldcell({
      cmd: 'event',
      crm_token: CRM_TOKEN,
      callid: 'call-2',
      type: 'INCOMING',
      phone: '37368879173',
    } as never);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'moldcell:event' }),
    );
    expect(record.mock.calls[0][0]).not.toHaveProperty('initialStatus');
    expect(markOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'raw-event-1', status: 'ENQUEUED' }),
    );
  });

  it('should stamp IGNORED on a push that does not normalize', async () => {
    // No callid, so nothing can be correlated — the row has to say why rather
    // than sit at RECEIVED looking like a handler that died.
    await controller.moldcell({
      cmd: 'history',
      crm_token: CRM_TOKEN,
    } as never);

    expect(markOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'IGNORED',
        note: 'history push did not normalize',
      }),
    );
  });

  it('should stamp IGNORED on an unrecognised cmd', async () => {
    await controller.moldcell({
      cmd: 'sms',
      crm_token: CRM_TOKEN,
    } as never);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'moldcell:sms' }),
    );
    expect(markOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'IGNORED',
        note: 'unrecognised cmd "sms"',
      }),
    );
  });
});

describe('TelephonyController contact answer', () => {
  let controller: TelephonyController;
  let annotate: jest.Mock;
  let add: jest.Mock;
  let resolveContact: jest.Mock;

  const contactPush = {
    cmd: 'contact',
    crm_token: CRM_TOKEN,
    callid: 'NEP847ASHK000037',
    phone: '37369453003',
    diversion: '37376040824',
  } as never;

  // The note is written off the response path; let it land.
  const flushBackgroundWork = () =>
    new Promise((resolve) => setImmediate(resolve));

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();

    annotate = jest.fn().mockResolvedValue(undefined);
    add = jest.fn().mockResolvedValue(undefined);
    resolveContact = jest.fn();

    controller = new TelephonyController(
      { add } as unknown as MessageQueueService,
      { resolveContact } as unknown as TelephonyContactService,
      {
        record: jest.fn().mockResolvedValue('raw-contact-1'),
        markOutcome: jest.fn(),
        annotate,
      } as unknown as EnsoInboundRawEventService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should answer the ringing call without waiting for the push to be queued', async () => {
    // A queue that never acknowledges must not hold up the routing answer.
    add.mockReturnValue(new Promise(() => undefined));
    resolveContact.mockResolvedValue({
      contact_name: 'Denis Vasiliev',
      responsible: 'olvanica_alexandru',
    });

    await expect(controller.moldcell(contactPush)).resolves.toEqual({
      contact_name: 'Denis Vasiliev',
      responsible: 'olvanica_alexandru',
    });
  });

  it('should note on the contact push which manager the CRM named', async () => {
    resolveContact.mockResolvedValue({ responsible: 'olvanica_alexandru' });

    await controller.moldcell(contactPush);
    await flushBackgroundWork();

    expect(annotate).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      id: 'raw-contact-1',
      note: expect.stringMatching(/^responsible=olvanica_alexandru in \d+ms$/),
    });
  });

  it('should note when the CRM found nobody to name', async () => {
    resolveContact.mockResolvedValue({ contact_name: 'Unknown Caller' });

    await controller.moldcell(contactPush);
    await flushBackgroundWork();

    expect(annotate).toHaveBeenCalledWith(
      expect.objectContaining({
        note: expect.stringMatching(/^no responsible in \d+ms$/),
      }),
    );
  });

  it('should answer with no responsible and say so when the lookup overruns its budget', async () => {
    jest.useFakeTimers();
    resolveContact.mockReturnValue(new Promise(() => undefined));

    const answer = controller.moldcell(contactPush);

    await jest.advanceTimersByTimeAsync(CONTACT_RESPONSE_BUDGET_MS);

    await expect(answer).resolves.toEqual({});

    jest.useRealTimers();
    await flushBackgroundWork();

    expect(annotate).toHaveBeenCalledWith(
      expect.objectContaining({
        note: `no responsible: lookup over the ${CONTACT_RESPONSE_BUDGET_MS}ms budget`,
      }),
    );
  });

  it('should answer with no responsible and say so when the lookup throws', async () => {
    resolveContact.mockRejectedValue(new Error('database unavailable'));

    await expect(controller.moldcell(contactPush)).resolves.toEqual({});
    await flushBackgroundWork();

    expect(annotate).toHaveBeenCalledWith(
      expect.objectContaining({
        note: expect.stringMatching(
          /^no responsible: lookup failed after \d+ms$/,
        ),
      }),
    );
  });
});
