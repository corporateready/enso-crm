import {
  buildConsentSubscriptionChanges,
  CONSENT_CHANNELS,
  type PersonProjectConsentRecord,
  PROJECT_SUBSCRIPTION_GROUPS,
  resolveProjectSubscriptionGroups,
  revokedConsentChannels,
  SUBSCRIPTION_GROUP_FIELD_BY_CHANNEL,
} from 'src/modules/enso/marketing-sync/marketing-sync.constants';

const FALLBACK_PROJECT_ID = Object.keys(PROJECT_SUBSCRIPTION_GROUPS)[0];
const UNCONFIGURED_PROJECT_ID = '00000000-0000-0000-0000-000000000000';

const consent = (
  overrides: Partial<PersonProjectConsentRecord> = {},
): PersonProjectConsentRecord => ({
  id: 'consent-1',
  personId: 'person-1',
  projectId: FALLBACK_PROJECT_ID,
  emailMarketingConsent: null,
  smsMarketingConsent: null,
  whatsappMarketingConsent: null,
  callMarketingConsent: null,
  updatedAt: '2026-09-15T00:00:00.000Z',
  ...overrides,
});

const projectWith = (
  groups: Partial<Record<(typeof CONSENT_CHANNELS)[number], string>>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(groups).map(([channel, groupId]) => [
      SUBSCRIPTION_GROUP_FIELD_BY_CHANNEL[
        channel as (typeof CONSENT_CHANNELS)[number]
      ],
      groupId,
    ]),
  );

// Subscription groups are configured per project in the CRM now, with the
// hardcoded map left as a fallback until the records are backfilled. Getting
// the precedence wrong either ignores what marketing configured or silently
// stops mirroring a live pilot, so it is pinned per channel here.
describe('resolveProjectSubscriptionGroups', () => {
  it('should prefer the ids on the project record', () => {
    const groups = resolveProjectSubscriptionGroups(
      FALLBACK_PROJECT_ID,
      projectWith({ email: 'from-project' }),
    );

    expect(groups.email).toBe('from-project');
  });

  it('should fall back per channel, not per project', () => {
    const groups = resolveProjectSubscriptionGroups(
      FALLBACK_PROJECT_ID,
      projectWith({ email: 'from-project' }),
    );

    // email came from the record; sms must still come from the fallback rather
    // than being switched off because the record only carried one channel.
    expect(groups.email).toBe('from-project');
    expect(groups.sms).toBe(
      PROJECT_SUBSCRIPTION_GROUPS[FALLBACK_PROJECT_ID].sms,
    );
  });

  it('should use the fallback when the project carries nothing', () => {
    expect(resolveProjectSubscriptionGroups(FALLBACK_PROJECT_ID, null)).toEqual(
      PROJECT_SUBSCRIPTION_GROUPS[FALLBACK_PROJECT_ID],
    );
  });

  it('should keep mirroring a fallback project when its record is missing', () => {
    const groups = resolveProjectSubscriptionGroups(
      FALLBACK_PROJECT_ID,
      undefined,
    );

    expect(Object.keys(groups).length).toBeGreaterThan(0);
  });

  it('should resolve nothing for a project configured nowhere', () => {
    expect(
      resolveProjectSubscriptionGroups(UNCONFIGURED_PROJECT_ID, null),
    ).toEqual({});
  });

  it('should let a project outside the fallback map configure itself', () => {
    const groups = resolveProjectSubscriptionGroups(
      UNCONFIGURED_PROJECT_ID,
      projectWith({ email: 'new-project-email', sms: 'new-project-sms' }),
    );

    expect(groups).toEqual({
      email: 'new-project-email',
      sms: 'new-project-sms',
    });
  });

  it.each(['', '   '])(
    'should treat a blank field (%p) as unconfigured',
    (blank) => {
      expect(
        resolveProjectSubscriptionGroups(
          UNCONFIGURED_PROJECT_ID,
          projectWith({ email: blank }),
        ),
      ).toEqual({});
    },
  );

  it('should trim a pasted id', () => {
    const groups = resolveProjectSubscriptionGroups(
      UNCONFIGURED_PROJECT_ID,
      projectWith({ email: '  padded-id\n' }),
    );

    expect(groups.email).toBe('padded-id');
  });

  it('should support a channel no project has been provisioned for yet', () => {
    const groups = resolveProjectSubscriptionGroups(
      UNCONFIGURED_PROJECT_ID,
      projectWith({ whatsapp: 'whatsapp-group' }),
    );

    expect(groups.whatsapp).toBe('whatsapp-group');
  });
});

describe('buildConsentSubscriptionChanges', () => {
  it('should map each configured channel to its consent boolean', () => {
    const changes = buildConsentSubscriptionChanges(
      { email: 'email-group', sms: 'sms-group' },
      consent({ emailMarketingConsent: true, smsMarketingConsent: false }),
    );

    expect(changes).toEqual({ 'email-group': true, 'sms-group': false });
  });

  it('should treat a null consent as not subscribed', () => {
    const changes = buildConsentSubscriptionChanges(
      { email: 'email-group' },
      consent({ emailMarketingConsent: null }),
    );

    expect(changes).toEqual({ 'email-group': false });
  });

  it('should be empty when no channel is configured', () => {
    expect(
      buildConsentSubscriptionChanges(
        {},
        consent({ emailMarketingConsent: true }),
      ),
    ).toEqual({});
  });
});

// A grant that misses Dittofeed costs us marketing; a revocation that misses it
// means we keep contacting someone who opted out. Only the second is escalated,
// so this helper decides which events get reported loudly.
describe('revokedConsentChannels', () => {
  it.each(CONSENT_CHANNELS)(
    'should report %s when it goes from granted to revoked',
    (channel) => {
      const field = `${channel}MarketingConsent` as const;

      expect(
        revokedConsentChannels(
          consent({ [field]: true }),
          consent({ [field]: false }),
        ),
      ).toEqual([channel]);
    },
  );

  it.each(CONSENT_CHANNELS)(
    'should treat %s going granted to null as a revocation',
    (channel) => {
      const field = `${channel}MarketingConsent` as const;

      expect(
        revokedConsentChannels(
          consent({ [field]: true }),
          consent({ [field]: null }),
        ),
      ).toEqual([channel]);
    },
  );

  it('should report nothing for a grant', () => {
    expect(
      revokedConsentChannels(
        consent({ emailMarketingConsent: false }),
        consent({ emailMarketingConsent: true }),
      ),
    ).toEqual([]);
  });

  it('should report nothing when consent is unchanged', () => {
    expect(
      revokedConsentChannels(
        consent({ emailMarketingConsent: true }),
        consent({ emailMarketingConsent: true }),
      ),
    ).toEqual([]);
  });

  it('should not treat a never-granted channel as revoked', () => {
    expect(
      revokedConsentChannels(
        consent({ emailMarketingConsent: null }),
        consent({ emailMarketingConsent: false }),
      ),
    ).toEqual([]);
  });

  it('should report every channel revoked in one edit', () => {
    const granted = consent({
      emailMarketingConsent: true,
      smsMarketingConsent: true,
      whatsappMarketingConsent: true,
      callMarketingConsent: true,
    });

    expect(revokedConsentChannels(granted, consent())).toEqual([
      ...CONSENT_CHANNELS,
    ]);
  });
});
