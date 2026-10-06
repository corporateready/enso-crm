import { type NewLeadFormValues } from '@/enso/manual-lead/types/NewLeadFormValues';
import { buildCreateManualLeadInput } from '@/enso/manual-lead/utils/buildCreateManualLeadInput';

const baseValues: NewLeadFormValues = {
  projectId: 'project-1',
  firstName: '  Ion ',
  lastName: '',
  phoneCallingCode: '+373',
  phoneNumber: '69123456',
  email: '',
  manualLeadSourceId: 'source-1',
  referredByName: '',
  occurredAt: '2026-10-06T10:00',
  destination: 'MINE',
  colleagueWorkspaceMemberId: 'member-2',
  startStage: 'LEAD_CLAIMED',
  firstContactAt: '2026-10-06T09:00',
  firstContactChannel: 'CALL',
  note: ' ',
  verbalConsentChannels: ['sms'],
};

describe('buildCreateManualLeadInput', () => {
  it('should send only what a Lead Claimed start means', () => {
    const input = buildCreateManualLeadInput(baseValues, 'request-1');

    expect(input).toMatchObject({
      requestId: 'request-1',
      firstName: 'Ion',
      lastName: undefined,
      phoneNumber: '69123456',
      phoneCallingCode: '+373',
      email: undefined,
      startStage: 'LEAD_CLAIMED',
      colleagueWorkspaceMemberId: undefined,
      firstContactAt: undefined,
      firstContactChannel: undefined,
      note: undefined,
      verbalConsentChannels: ['sms'],
    });
  });

  it('should send the first contact when the lead starts Connected', () => {
    const input = buildCreateManualLeadInput(
      { ...baseValues, startStage: 'CONNECTED' },
      'request-1',
    );

    expect(input.firstContactAt).toBe(
      new Date('2026-10-06T09:00').toISOString(),
    );
    expect(input.firstContactChannel).toBe('CALL');
  });

  it('should send the colleague and no stage when handing the lead over', () => {
    const input = buildCreateManualLeadInput(
      { ...baseValues, destination: 'COLLEAGUE', startStage: 'CONNECTED' },
      'request-1',
    );

    expect(input.colleagueWorkspaceMemberId).toBe('member-2');
    expect(input.startStage).toBeUndefined();
    expect(input.firstContactAt).toBeUndefined();
  });

  it('should leave the calling code out when there is no phone', () => {
    const input = buildCreateManualLeadInput(
      { ...baseValues, phoneNumber: '', email: 'ion@example.com' },
      'request-1',
    );

    expect(input.phoneCallingCode).toBeUndefined();
    expect(input.email).toBe('ion@example.com');
  });
});
