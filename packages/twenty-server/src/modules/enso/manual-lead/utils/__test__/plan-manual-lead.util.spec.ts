import {
  type ManualLeadPlanInput,
  planManualLead,
} from 'src/modules/enso/manual-lead/utils/plan-manual-lead.util';

const NOW = new Date('2026-10-06T12:00:00.000Z');
const ME = 'member-me';

const context = {
  viewerWorkspaceMemberId: ME,
  sourceCategory: 'OWN_NETWORK',
  now: NOW,
};

const baseInput: ManualLeadPlanInput = {
  firstName: 'Ion',
  phoneNumber: '69123456',
  destination: 'MINE',
};

describe('planManualLead', () => {
  it('should start a lead the manager keeps at Lead Claimed by default', () => {
    expect(planManualLead(baseInput, context)).toEqual({
      ok: true,
      plan: {
        destination: 'MINE',
        stage: 'LEAD_CLAIMED',
        ownerMemberId: ME,
        firstContactAt: null,
        firstContactChannel: null,
      },
    });
  });

  it('should start at Connected when the first contact is given', () => {
    const firstContactAt = new Date('2026-10-05T09:00:00.000Z');

    expect(
      planManualLead(
        {
          ...baseInput,
          startStage: 'CONNECTED',
          firstContactAt,
          firstContactChannel: 'CALL',
        },
        context,
      ),
    ).toEqual({
      ok: true,
      plan: {
        destination: 'MINE',
        stage: 'CONNECTED',
        ownerMemberId: ME,
        firstContactAt,
        firstContactChannel: 'CALL',
      },
    });
  });

  it('should ask for the stage fields that are missing', () => {
    expect(
      planManualLead(
        { ...baseInput, startStage: 'CONNECTED', firstContactChannel: 'CALL' },
        context,
      ),
    ).toEqual({
      ok: false,
      error: 'Fill in First contact date to start this lead at Connected.',
    });
  });

  it('should refuse a stage past Connected', () => {
    expect(
      planManualLead({ ...baseInput, startStage: 'DEMO' }, context).ok,
    ).toBe(false);
  });

  it('should hand a lead to a colleague at Lead Claimed whatever stage was asked', () => {
    const result = planManualLead(
      {
        ...baseInput,
        destination: 'COLLEAGUE',
        colleagueWorkspaceMemberId: 'member-colleague',
        startStage: 'CONNECTED',
        firstContactAt: NOW,
        firstContactChannel: 'CALL',
      },
      context,
    );

    expect(result).toEqual({
      ok: true,
      plan: {
        destination: 'COLLEAGUE',
        stage: 'LEAD_CLAIMED',
        ownerMemberId: 'member-colleague',
        firstContactAt: null,
        firstContactChannel: null,
      },
    });
  });

  it('should refuse handing a lead to yourself as a colleague', () => {
    expect(
      planManualLead(
        {
          ...baseInput,
          destination: 'COLLEAGUE',
          colleagueWorkspaceMemberId: ME,
        },
        context,
      ).ok,
    ).toBe(false);
  });

  it('should send a routed lead to Routing with no owner', () => {
    expect(
      planManualLead({ ...baseInput, destination: 'ROUTING' }, context),
    ).toEqual({
      ok: true,
      plan: {
        destination: 'ROUTING',
        stage: 'ROUTING',
        ownerMemberId: null,
        firstContactAt: null,
        firstContactChannel: null,
      },
    });
  });

  it('should need a way to reach the lead', () => {
    expect(
      planManualLead({ firstName: 'Ion', destination: 'MINE' }, context),
    ).toEqual({
      ok: false,
      error: 'Add a phone number or an email, so the lead can be reached.',
    });
  });

  it('should accept an email instead of a phone', () => {
    expect(
      planManualLead(
        { firstName: 'Ion', email: 'ion@example.com', destination: 'MINE' },
        context,
      ).ok,
    ).toBe(true);
  });

  it('should need a referrer for a referral', () => {
    const referralContext = { ...context, sourceCategory: 'REFERRAL' };

    expect(planManualLead(baseInput, referralContext)).toEqual({
      ok: false,
      error: 'Say who referred this lead.',
    });
    expect(
      planManualLead(
        { ...baseInput, referredByName: 'Maria from the office' },
        referralContext,
      ).ok,
    ).toBe(true);
  });

  it('should refuse dates in the future', () => {
    expect(
      planManualLead(
        { ...baseInput, occurredAt: new Date('2026-10-07T12:00:00.000Z') },
        context,
      ).ok,
    ).toBe(false);
  });

  it('should refuse unknown consent channels', () => {
    expect(
      planManualLead(
        { ...baseInput, verbalConsentChannels: ['sms', 'telepathy'] },
        context,
      ).ok,
    ).toBe(false);
  });
});
