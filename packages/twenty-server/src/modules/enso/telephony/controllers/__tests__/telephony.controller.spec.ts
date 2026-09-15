import { type MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { type EnsoInboundRawEventService } from 'src/modules/enso/inbound-raw-event/services/enso-inbound-raw-event.service';
import { TelephonyController } from 'src/modules/enso/telephony/controllers/telephony.controller';
import { type TelephonyContactService } from 'src/modules/enso/telephony/services/telephony-contact.service';

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
  let add: jest.Mock;
  let resolveContact: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    record = jest.fn().mockResolvedValue('raw-event-1');
    markOutcome = jest.fn().mockResolvedValue(undefined);
    add = jest.fn().mockResolvedValue(undefined);
    resolveContact = jest.fn().mockResolvedValue({});

    controller = new TelephonyController(
      { add } as unknown as MessageQueueService,
      { resolveContact } as unknown as TelephonyContactService,
      { record, markOutcome } as unknown as EnsoInboundRawEventService,
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
