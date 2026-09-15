import {
  buildConsentSubscriptionChanges,
  CONSENT_CHANNELS,
  type PersonProjectConsentRecord,
  resolveProjectSubscriptionGroups,
  revokedConsentChannels,
  SUBSCRIPTION_GROUP_FIELD_BY_CHANNEL,
} from 'src/modules/enso/marketing-sync/marketing-sync.constants';

const consent = (
  overrides: Partial<PersonProjectConsentRecord> = {},
): PersonProjectConsentRecord => ({
  id: 'consent-1',
  personId: 'person-1',
  projectId: 'project-1',
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

// Subscription groups are configured per project in the CRM — the Project
// record is the only source since the hardcoded fallback was deleted. A blank
// field must read as unconfigured rather than as a group id, or the mirror
// would push consent at an empty subscription group.
describe('resolveProjectSubscriptionGroups', () => {
  it('should read the ids off the project record', () => {
    expect(
      resolveProjectSubscriptionGroups(
        projectWith({ email: 'email-group', sms: 'sms-group' }),
      ),
    ).toEqual({ email: 'email-group', sms: 'sms-group' });
  });

  it('should resolve only the channels that are set', () => {
    expect(
      resolveProjectSubscriptionGroups(projectWith({ email: 'email-group' })),
    ).toEqual({ email: 'email-group' });
  });

  it.each([null, undefined])(
    'should resolve nothing when the project is %p',
    (project) => {
      expect(resolveProjectSubscriptionGroups(project)).toEqual({});
    },
  );

  it('should resolve nothing for a project with no ids set', () => {
    expect(resolveProjectSubscriptionGroups({})).toEqual({});
  });

  // Twenty stores an unset TEXT field as '', not null — the live records read
  // back that way before they were backfilled.
  it.each(['', '   ', '\n'])(
    'should treat a blank field (%p) as unconfigured',
    (blank) => {
      expect(
        resolveProjectSubscriptionGroups(projectWith({ email: blank })),
      ).toEqual({});
    },
  );

  it('should trim a pasted id', () => {
    expect(
      resolveProjectSubscriptionGroups(projectWith({ email: '  padded-id\n' }))
        .email,
    ).toBe('padded-id');
  });

  it('should support a channel no project has been provisioned for yet', () => {
    expect(
      resolveProjectSubscriptionGroups(projectWith({ whatsapp: 'wa-group' }))
        .whatsapp,
    ).toBe('wa-group');
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
