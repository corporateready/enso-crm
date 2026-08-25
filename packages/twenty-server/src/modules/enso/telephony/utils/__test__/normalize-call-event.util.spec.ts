import {
  normalizeE164,
  normalizeMoldcellEvent,
  normalizeMoldcellHistory,
  normalizeRoistatCall,
  parseMoldcellTimestamp,
  parseRoistatTimestamp,
  splitPbxLogin,
} from 'src/modules/enso/telephony/utils/normalize-call-event.util';

describe('normalizeE164', () => {
  it('should prefix international Moldovan and Romanian numbers', () => {
    // Shape observed on live PBX and Roistat traffic: full international, no '+'.
    expect(normalizeE164('37368879173')).toBe('+37368879173');
    expect(normalizeE164('40376300594')).toBe('+40376300594');
  });

  it('should strip formatting characters', () => {
    expect(normalizeE164('+373 (68) 879-173')).toBe('+37368879173');
  });

  it('should strip the international access code', () => {
    expect(normalizeE164('0037368879173')).toBe('+37368879173');
  });

  it('should promote a national number using the dialled DID as country hint', () => {
    // This is the case the legacy stack got wrong: without promotion the number
    // matched neither '373' nor '40', so the call lost its country and routing.
    expect(normalizeE164('068879173', '37376015220')).toBe('+37368879173');
    expect(normalizeE164('0376300594', '40376300594')).toBe('+40376300594');
  });

  it('should refuse a national number when the DID gives no usable country', () => {
    expect(normalizeE164('068879173', undefined)).toBeUndefined();
    expect(normalizeE164('068879173', '12125551234')).toBeUndefined();
  });

  it('should refuse internal extensions rather than mint a bogus contact', () => {
    expect(normalizeE164('701')).toBeUndefined();
    expect(normalizeE164('')).toBeUndefined();
    expect(normalizeE164(null)).toBeUndefined();
  });
});

describe('splitPbxLogin', () => {
  it('should identify an individual employee login', () => {
    expect(splitPbxLogin('anatol_rosior@enso.pbx.moldcell.md')).toEqual({
      login: 'anatol_rosior',
      isGroup: false,
    });
  });

  it('should identify a group login', () => {
    // Groups answer as departments; treating one as a person would report a
    // pickup that never happened.
    const result = splitPbxLogin(
      'g_eb8192a7-b8b8-4e92-bdcd-0ef6d6ee395f@enso.pbx.moldcell.md',
    );

    expect(result.isGroup).toBe(true);
  });

  it('should handle a missing value', () => {
    expect(splitPbxLogin(undefined)).toEqual({ isGroup: false });
  });
});

describe('timestamp parsing', () => {
  it('should parse the compact push format', () => {
    expect(parseMoldcellTimestamp('20260825T113440Z')?.toISOString()).toBe(
      '2026-08-25T11:34:40.000Z',
    );
  });

  it('should also parse the extended format the history response uses', () => {
    expect(parseMoldcellTimestamp('2026-08-25T11:34:40Z')?.toISOString()).toBe(
      '2026-08-25T11:34:40.000Z',
    );
  });

  it('should treat a zoneless Roistat timestamp as UTC', () => {
    expect(parseRoistatTimestamp('2026-08-22 15:08:50')?.toISOString()).toBe(
      '2026-08-22T15:08:50.000Z',
    );
  });

  it('should return undefined for unparseable input', () => {
    expect(parseMoldcellTimestamp('not-a-date')).toBeUndefined();
    expect(parseRoistatTimestamp('')).toBeUndefined();
  });
});

describe('normalizeMoldcellEvent', () => {
  it('should stamp occurredAt only for INCOMING', () => {
    // INCOMING fires while the phone rings, so it approximates the call start.
    // COMPLETED/CANCELLED fire at the end — stamping those with "now" would move
    // occurredAt to the wrong end of the call and break the correlation window.
    expect(
      normalizeMoldcellEvent({ cmd: 'event', type: 'INCOMING', callid: 'c1' })
        ?.occurredAt,
    ).toBeInstanceOf(Date);

    expect(
      normalizeMoldcellEvent({ cmd: 'event', type: 'COMPLETED', callid: 'c1' })
        ?.occurredAt,
    ).toBeUndefined();
  });

  it('should never claim authority over the outcome', () => {
    const event = normalizeMoldcellEvent({
      cmd: 'event',
      type: 'COMPLETED',
      callid: 'c1',
    });

    expect(event?.isAuthoritativeOutcome).toBe(false);
  });

  it('should give COMPLETED and history distinct event keys for the same call', () => {
    // They share a `callid`; if the queue dedup key collapsed them the history
    // push — the only one carrying duration and recording — would be dropped.
    const completed = normalizeMoldcellEvent({
      cmd: 'event',
      type: 'COMPLETED',
      callid: 'c1',
    });
    const history = normalizeMoldcellHistory({
      cmd: 'history',
      callid: 'c1',
      status: 'Success',
    });

    expect(completed?.externalId).toBe(history?.externalId);
    expect(completed?.eventKey).not.toBe(history?.eventKey);
  });

  it('should record who answered on ACCEPTED but not for a group', () => {
    expect(
      normalizeMoldcellEvent({
        cmd: 'event',
        type: 'ACCEPTED',
        callid: 'c1',
        user: 'anatol_rosior@enso.pbx.moldcell.md',
      })?.answeredByLogin,
    ).toBe('anatol_rosior');

    expect(
      normalizeMoldcellEvent({
        cmd: 'event',
        type: 'ACCEPTED',
        callid: 'c1',
        user: 'g_abc@enso.pbx.moldcell.md',
      })?.answeredByLogin,
    ).toBeUndefined();
  });

  it('should return undefined without a callid', () => {
    expect(
      normalizeMoldcellEvent({ cmd: 'event', type: 'INCOMING' }),
    ).toBeUndefined();
  });
});

describe('normalizeMoldcellHistory', () => {
  it('should map a successful call and carry the recording', () => {
    const event = normalizeMoldcellHistory({
      cmd: 'history',
      type: 'in',
      status: 'Success',
      phone: '37369267842',
      diversion: '37376015492',
      start: '20260825T103102Z',
      duration: '127',
      callid: 'HLH8HFM77S000035',
      link: 'https://enso.pbx.moldcell.md/rec.mp3',
      user: 'anatol_rosior@enso.pbx.moldcell.md',
    });

    expect(event?.callStatus).toBe('ANSWERED');
    expect(event?.durationS).toBe(127);
    expect(event?.recordingUrl).toBe('https://enso.pbx.moldcell.md/rec.mp3');
    expect(event?.callerE164).toBe('+37369267842');
    expect(event?.isAuthoritativeOutcome).toBe(true);
  });

  it('should map a missed call to UNANSWERED', () => {
    const event = normalizeMoldcellHistory({
      cmd: 'history',
      status: 'Missed',
      callid: 'c2',
      duration: '0',
    });

    expect(event?.callStatus).toBe('UNANSWERED');
    expect(event?.durationS).toBe(0);
  });

  it('should not treat an individual login on a missed call as a pickup signal', () => {
    // Observed repeatedly in live history: a real employee login sits in the
    // answered-by column for calls nobody picked up. Only the status decides.
    const event = normalizeMoldcellHistory({
      cmd: 'history',
      status: 'Missed',
      callid: 'c3',
      user: 'olvanica_alexandru@enso.pbx.moldcell.md',
    });

    expect(event?.callStatus).toBe('UNANSWERED');
  });
});

describe('normalizeRoistatCall', () => {
  const attribution = {
    utm_source: 'instagram',
    utm_medium: 'static_call_tracking',
    utm_campaign: 'artima_instagram',
    project_id: 'ENS2301',
  };

  it('should treat the at-call slot as non-authoritative but keep attribution', () => {
    // The at-call push carries UTMs and project_id but no outcome — which is why
    // a lead can be identified seconds into the call.
    const event = normalizeRoistatCall({
      id: '108157638',
      caller: '37368096525',
      callee: '37379350141',
      date: '2026-08-22 15:08:50',
      custom_fields: attribution,
    });

    expect(event?.isAuthoritativeOutcome).toBe(false);
    expect(event?.eventKey).toBe('roistat:at-call');
    expect(event?.attribution?.projectCode).toBe('ENS2301');
    expect(event?.attribution?.utmCampaign).toBe('artima_instagram');
    expect(event?.callStatus).toBeUndefined();
  });

  it('should treat the after-call slot as authoritative', () => {
    const event = normalizeRoistatCall({
      id: '108157638',
      caller: '37368096525',
      callee: '37379350141',
      date: '2026-08-22 15:08:50',
      status: 'ANSWER',
      duration: 272,
      link: 'https://cloud.roistat.com/rec.mp3',
      custom_fields: attribution,
    });

    expect(event?.isAuthoritativeOutcome).toBe(true);
    expect(event?.eventKey).toBe('roistat:after-call');
    expect(event?.callStatus).toBe('ANSWERED');
    expect(event?.durationS).toBe(272);
  });

  it('should leave roistatVisitId unset for static tracking', () => {
    // Static scenarios send visit_id: null; only dynamic ones populate it.
    const event = normalizeRoistatCall({
      id: '1',
      caller: '37368096525',
      callee: '37379350141',
      visit_id: null,
      custom_fields: attribution,
    });

    expect(event?.attribution?.roistatVisitId).toBeUndefined();
  });

  it('should map NOANSWER to UNANSWERED', () => {
    expect(
      normalizeRoistatCall({ id: '1', status: 'NOANSWER', duration: 0 })
        ?.callStatus,
    ).toBe('UNANSWERED');
  });

  it('should keep the two providers in separate id spaces', () => {
    const roistat = normalizeRoistatCall({ id: 'X' });
    const moldcell = normalizeMoldcellHistory({ cmd: 'history', callid: 'X' });

    expect(roistat?.externalId).not.toBe(moldcell?.externalId);
  });
});
