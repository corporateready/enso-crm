import {
  buildConsentSubscriptionChanges,
  CONSENT_CHANNELS,
  hasProjectSubscriptionGroups,
  type PersonProjectConsentRecord,
  PROJECT_SUBSCRIPTION_GROUPS,
  revokedConsentChannels,
} from 'src/modules/enso/marketing-sync/marketing-sync.constants';

const MAPPED_PROJECT_ID = Object.keys(PROJECT_SUBSCRIPTION_GROUPS)[0];
const UNMAPPED_PROJECT_ID = '00000000-0000-0000-0000-000000000000';

const consent = (
  overrides: Partial<PersonProjectConsentRecord> = {},
): PersonProjectConsentRecord => ({
  id: 'consent-1',
  personId: 'person-1',
  projectId: MAPPED_PROJECT_ID,
  emailMarketingConsent: null,
  smsMarketingConsent: null,
  whatsappMarketingConsent: null,
  callMarketingConsent: null,
  updatedAt: '2026-09-15T00:00:00.000Z',
  ...overrides,
});

// An unmapped project produces no subscription changes, which is why its
// consent edits used to pass silently. The listener tells the two cases apart
// through hasProjectSubscriptionGroups, so that predicate must stay in step
// with the map it guards.
describe('hasProjectSubscriptionGroups', () => {
  it('should be true for every project in the map', () => {
    for (const projectId of Object.keys(PROJECT_SUBSCRIPTION_GROUPS)) {
      expect(hasProjectSubscriptionGroups(projectId)).toBe(true);
    }
  });

  it('should be false for a project nobody has mapped', () => {
    expect(hasProjectSubscriptionGroups(UNMAPPED_PROJECT_ID)).toBe(false);
  });

  it('should agree with buildConsentSubscriptionChanges being empty', () => {
    const record = consent({
      projectId: UNMAPPED_PROJECT_ID,
      emailMarketingConsent: true,
    });

    expect(hasProjectSubscriptionGroups(UNMAPPED_PROJECT_ID)).toBe(false);
    expect(
      buildConsentSubscriptionChanges(UNMAPPED_PROJECT_ID, record),
    ).toEqual({});
  });
});

// A grant that misses Dittofeed costs us marketing; a revocation that misses it
// means we keep sending to someone who opted out. Only the second is escalated,
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
