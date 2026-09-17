import {
  BLOCK_SEPARATOR,
  buildProjectDealMessage,
} from 'src/modules/enso/lead-pipeline/utils/build-project-deal-message.util';

// The layout is copied from the alerts already sitting in the per-project
// Google Chat rooms. These assertions exist so a future refactor cannot quietly
// change a label or drop the underscore rule — people in those rooms quote and
// reply to individual lines.
describe('buildProjectDealMessage', () => {
  it('should render a lead-ad message in the shape the rooms already use', () => {
    const message = buildProjectDealMessage({
      projectName: 'Vanzari Imobiliare',
      fullName: 'Andrew Fillyn',
      phone: '+37361096304',
      activity: {
        kind: 'LEAD_AD',
        source: 'instagram',
        // 11:20:27 Chișinău on 2026-09-03 is 08:20:27Z (UTC+3 in September).
        occurredAt: new Date('2026-09-03T08:20:27.000Z'),
        m2Requested: 98,
        utmSource: 'facebook',
        utmMedium: 'paid_social_leads_ad',
        utmCampaign: 'newton_buiucani_comercial_new_2025',
        utmContent: 'limit_offer_1800_euro_m_ad_leads_ad_newton_buiucani_ro',
        utmTerm: 'picture_space_with_pillars',
      },
    });

    expect(message).toBe(
      [
        'Activity Type: Instagram Lead Ad Form',
        'Full Name: Andrew Fillyn',
        'Client Number: +37361096304',
        'Email: ',
        'Project: Vanzari Imobiliare',
        'Area: 98 m²',
        'Timestamp: 2026-09-03 11:20:27',
        BLOCK_SEPARATOR,
        '',
        'utm_source: facebook',
        'utm_medium: paid_social_leads_ad',
        'utm_campaign: newton_buiucani_comercial_new_2025',
        'utm_content: limit_offer_1800_euro_m_ad_leads_ad_newton_buiucani_ro',
        'utm_term: picture_space_with_pillars',
      ].join('\n'),
    );
  });

  it('should render an inbound call with its status, dialled number and duration', () => {
    const message = buildProjectDealMessage(
      {
        projectName: 'ARTIMA Business & Lifestyle',
        fullName: 'Maxim Marandici',
        phone: '+37360686295',
        email: 'marandichmax@gmail.com',
        activity: {
          kind: 'INCOMING_CALL',
          callStatus: 'ANSWERED',
          calleeDid: '37376040564',
          durationS: 86,
          occurredAt: new Date('2026-09-03T08:20:27.000Z'),
          utmSource: 'instagram',
          utmMedium: 'static_call_tracking',
          utmCampaign: 'artima_instagram',
          utmContent: 'instagram_page_description',
        },
      },
      'https://crm.enso.ro/object/opportunity/deal-1',
    );

    expect(message).toBe(
      [
        'Activity Type: Incoming Call',
        'Full Name: Maxim Marandici',
        'Client Number: +37360686295',
        'Email: marandichmax@gmail.com',
        'Project: ARTIMA Business & Lifestyle',
        'Status: ANSWERED',
        'Company Number: 37376040564',
        'Duration: 86 sec',
        'Timestamp: 2026-09-03 11:20:27',
        BLOCK_SEPARATOR,
        '',
        'utm_source: instagram',
        'utm_medium: static_call_tracking',
        'utm_campaign: artima_instagram',
        'utm_content: instagram_page_description',
        '',
        'https://crm.enso.ro/object/opportunity/deal-1',
      ].join('\n'),
    );
  });

  // The live regression: a call rang two extensions, the first one's CANCELLED
  // wrote ABANDONED, and the post went out while Oleg was 98 seconds into the
  // conversation. Whatever the column says, an individual accepted the call.
  it('should not call a call abandoned when an individual picked it up', () => {
    const message = buildProjectDealMessage({
      phone: '+37378447626',
      activity: {
        kind: 'INCOMING_CALL',
        callStatus: 'ABANDONED',
        salesPickup: true,
        calleeDid: '37376015472',
      },
    });

    expect(message).toContain('Status: ANSWERED');
    expect(message).not.toContain('ABANDONED');
  });

  // SALES_PICKUP is what the row holds between the pickup and the call ending.
  // These rooms have only ever spoken the phone system's vocabulary.
  it('should say ANSWERED rather than the CRM\u2019s own pickup status', () => {
    const message = buildProjectDealMessage({
      phone: '+37378447626',
      activity: { kind: 'INCOMING_CALL', callStatus: 'SALES_PICKUP' },
    });

    expect(message).toContain('Status: ANSWERED');
    expect(message).not.toContain('SALES_PICKUP');
  });

  it('should leave a genuinely abandoned call alone', () => {
    const message = buildProjectDealMessage({
      phone: '+37378447626',
      activity: {
        kind: 'INCOMING_CALL',
        callStatus: 'ABANDONED',
        salesPickup: false,
      },
    });

    expect(message).toContain('Status: ABANDONED');
  });

  it('should say so explicitly when the lead arrived with no attribution', () => {
    const message = buildProjectDealMessage({
      fullName: 'Ion Popescu',
      phone: '+37360000000',
      activity: { kind: 'FORM_SUBMISSION' },
    });

    expect(message).toContain('no attribution — this lead arrived untagged');
    // Never five blank utm_ lines.
    expect(message).not.toContain('utm_source:');
  });

  it('should name the platform from the social payload, not from CHATWOOT', () => {
    const message = buildProjectDealMessage({
      projectName: 'ARTIMA Business & Lifestyle',
      fullName: 'Constantin Ceban',
      activity: {
        kind: 'SOCIAL_MESSAGE',
        source: 'CHATWOOT',
        platform: 'INSTAGRAM',
        trafficType: 'SOCIAL',
        occurredAt: new Date('2026-09-07T19:07:30.000Z'),
      },
    });

    expect(message).toContain('Activity Type: Instagram Social Message');
  });

  it('should distinguish an organic DM from a lost campaign', () => {
    const message = buildProjectDealMessage({
      activity: {
        kind: 'SOCIAL_MESSAGE',
        source: 'CHATWOOT',
        platform: 'INSTAGRAM',
        trafficType: 'SOCIAL',
      },
    });

    expect(message).toContain(
      'no utm tags — organic Instagram DM, no ad click to attribute',
    );
    expect(message).not.toContain('untagged');
  });

  it('should call out a paid click whose ad carried no ref', () => {
    const message = buildProjectDealMessage({
      activity: {
        kind: 'SOCIAL_MESSAGE',
        source: 'CHATWOOT',
        platform: 'FACEBOOK',
        trafficType: 'PAID',
      },
    });

    expect(message).toContain(
      'no utm tags — paid ad click, but the ad carried no ref',
    );
  });

  it('should print the traffic type when it is neither organic social nor paid', () => {
    const message = buildProjectDealMessage({
      activity: { kind: 'FORM_SUBMISSION', trafficType: 'REFERRAL' },
    });

    expect(message).toContain('no utm tags — traffic type: REFERRAL');
  });

  // A Roistat dynamic-tracking call is the one inbound channel that carries a
  // real referring URL, and it is what these rooms asked to see.
  it('should print the referrer under the landing page', () => {
    const message = buildProjectDealMessage({
      projectName: 'ARTIMA Business & Lifestyle',
      activity: {
        kind: 'INCOMING_CALL',
        callStatus: 'ANSWERED',
        calleeDid: '37376040824',
        durationS: 41,
        landingPage: 'artima.md',
        referrer: 'https://www.google.com/',
        occurredAt: new Date('2026-09-10T08:20:27.000Z'),
        utmSource: 'website',
        utmMedium: 'dynamic_call_tracking',
        utmCampaign: 'artima_website',
      },
    });

    expect(message).toContain(
      ['Landing Page: artima.md', 'Referrer: https://www.google.com/'].join(
        '\n',
      ),
    );
  });

  // `$direct` is a sentinel, not a site. Leaking it into a room that has never
  // shown a `$`-prefixed token would read as a broken tag.
  it('should say a direct visit in words rather than printing $direct', () => {
    const message = buildProjectDealMessage({
      activity: {
        kind: 'FORM_SUBMISSION',
        landingPage: 'https://artima.md/ru',
        referrer: '$direct',
      },
    });

    expect(message).toContain('Referrer: direct — no referring site');
    expect(message).not.toContain('$direct');
  });

  it('should omit the referrer line when the touch carried none', () => {
    const message = buildProjectDealMessage({
      activity: { kind: 'SOCIAL_MESSAGE', platform: 'INSTAGRAM' },
    });

    expect(message).not.toContain('Referrer');
  });

  it('should keep the separator exactly 37 underscores', () => {
    expect(BLOCK_SEPARATOR).toBe('_____________________________________');
    expect(BLOCK_SEPARATOR).toHaveLength(37);
  });

  it('should drop an unparseable timestamp rather than printing Invalid Date', () => {
    const message = buildProjectDealMessage({
      activity: { kind: 'FORM_SUBMISSION', occurredAt: 'not-a-date' },
    });

    expect(message).not.toContain('Timestamp');
    expect(message).not.toContain('Invalid');
  });
});
