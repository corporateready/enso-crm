import {
  normalizeE164,
  normalizeMoldcellContact,
  normalizeMoldcellEvent,
  normalizeMoldcellHistory,
  normalizeRoistatCall,
  parseMoldcellTimestamp,
  parseRoistatTimestamp,
  splitPbxLogin,
} from 'src/modules/enso/telephony/utils/normalize-call-event.util';
import {
  CALL_STATUS_TO_OUTBOUND_OUTCOME,
  MOLDCELL_STATUS_TO_CALL_STATUS,
  toCallStatus,
} from 'src/modules/enso/telephony/telephony.constants';

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

// A live missed call arrived as `status: "missed", user: "pbx"` — lower-cased
// where the docs say `Missed`, and attributed to the switch itself. Both details
// mattered: an unmapped status read as "no status", which combined with a
// person-looking `user` marked a call NOBODY answered as a sales pickup, and that
// in turn would have opened the deal CONNECTED.
describe('missed calls reported by the PBX itself', () => {
  it('should map the status whatever its casing', () => {
    for (const status of ['missed', 'Missed', 'MISSED', ' missed ']) {
      expect(
        normalizeMoldcellHistory({
          cmd: 'history',
          type: 'in',
          status,
          callid: 'c1',
        })?.callStatus,
      ).toBe('UNANSWERED');
    }

    // The rest of the documented set, through the same case-insensitive path.
    expect(toCallStatus('Success')).toBe('ANSWERED');
    expect(toCallStatus('notavailable')).toBe('CONGESTION');
    expect(toCallStatus('something-new')).toBeUndefined();
  });

  it('should not treat the switch as the person who answered', () => {
    const event = normalizeMoldcellHistory({
      cmd: 'history',
      type: 'in',
      status: 'missed',
      user: 'pbx',
      group: 'g_e2079b5f-25f7-4743-9323-761429e73aeb',
      callid: 'J5H44UHD0G000036',
      groupRealName: 'Newton House Gradina Botanica',
    });

    expect(event?.answeredByLogin).toBeUndefined();
    expect(event?.answeredByGroup).toBe('Newton House Gradina Botanica');
  });

  it('should treat `pbx` as a non-person wherever a login is parsed', () => {
    expect(splitPbxLogin('pbx').isGroup).toBe(true);
    expect(splitPbxLogin('pbx@enso.pbx.moldcell.md').isGroup).toBe(true);
    // A real employee whose login merely contains those letters must be fine.
    expect(splitPbxLogin('pbxadmin_ion').isGroup).toBe(false);
  });
});

// A department call rings several extensions; the ones that lose the race each
// get their OWN `event CANCELLED` naming their user. Verified live: Alexandr
// answered on ext 722 while Denis's ext 704 was cancelled. Treating that push as
// the call's outcome, or its user as the answerer, opened an answered call in
// ROUTING under the wrong name.
describe('per-leg CANCELLED on a department call', () => {
  it('should never name the cancelled leg as the person who answered', () => {
    const cancelled = normalizeMoldcellEvent({
      cmd: 'event',
      type: 'CANCELLED',
      direction: 'in',
      callid: 'J5B9FFOD60000038',
      // The push DOES carry a user — the manager whose phone stopped ringing.
      user: 'denis_vasiliev',
      ext: '704',
      phone: '37360177070',
      diversion: '37376040824',
      groupRealName: 'ARTIMA',
    });

    expect(cancelled?.answeredByLogin).toBeUndefined();
  });

  it('should not mark a cancelled leg as authoritative about the outcome', () => {
    // It may claim ABANDONED — that is the only outcome signal a missed call
    // ever produces — but it must never outrank the `history` push, which is
    // what keeps an answered call from being downgraded.
    const cancelled = normalizeMoldcellEvent({
      cmd: 'event',
      type: 'CANCELLED',
      direction: 'in',
      callid: 'c1',
      user: 'denis_vasiliev',
    });

    expect(cancelled?.isAuthoritativeOutcome).toBe(false);
    expect(cancelled?.isTerminal).toBe(true);

    const history = normalizeMoldcellHistory({
      cmd: 'history',
      type: 'in',
      status: 'Success',
      callid: 'c1',
      user: 'olvanica_alexandru',
    });

    expect(history?.isAuthoritativeOutcome).toBe(true);
    expect(history?.callStatus).toBe('ANSWERED');
    expect(history?.answeredByLogin).toBe('olvanica_alexandru');
  });

  it('should still name the answerer from the ACCEPTED push', () => {
    expect(
      normalizeMoldcellEvent({
        cmd: 'event',
        type: 'ACCEPTED',
        direction: 'in',
        callid: 'J5B9FFOD60000038',
        user: 'olvanica_alexandru',
        ext: '722',
      })?.answeredByLogin,
    ).toBe('olvanica_alexandru');
  });
});

describe('outbound calls', () => {
  // Direction decides which object the call becomes. Getting it wrong is the bug
  // observed live: a manager dialling out arrived as `type: OUTGOING,
  // direction: out` and was filed as an INCOMING_CALL, inflating lead counts and
  // creating a Person for someone we called.
  it('should mark an outbound event push as outbound', () => {
    const event = normalizeMoldcellEvent({
      cmd: 'event',
      type: 'OUTGOING',
      direction: 'out',
      callid: 'c1',
      phone: '37369743418',
      telnum: '37376040824',
    });

    expect(event?.direction).toBe('out');
    // OUTGOING fires as the call is placed, so it approximates the start.
    expect(event?.occurredAt).toBeDefined();
    expect(event?.callerE164).toBe('+37369743418');
  });

  it('should mark an event as outbound even when the type is a state name', () => {
    expect(
      normalizeMoldcellEvent({
        cmd: 'event',
        type: 'COMPLETED',
        direction: 'out',
        callid: 'c1',
      })?.direction,
    ).toBe('out');
  });

  it('should mark an outbound history push as outbound', () => {
    // On `history` the direction lives in `type` itself, not in `direction`.
    expect(
      normalizeMoldcellHistory({
        cmd: 'history',
        type: 'out',
        status: 'Success',
        callid: 'c1',
      })?.direction,
    ).toBe('out');
  });

  // Outbound has no `diversion`, so the manager's own direct number is the only
  // country hint available for a nationally-formatted destination.
  it('should promote a national destination using telnum as the country hint', () => {
    expect(
      normalizeMoldcellHistory({
        cmd: 'history',
        type: 'out',
        status: 'Success',
        callid: 'c1',
        phone: '069453003',
        telnum: '37376040824',
      })?.callerE164,
    ).toBe('+37369453003');
  });

  // On outbound there is no "who answered" — the login IS the manager who
  // dialled, which is what attributes the touch.
  it('should attribute an outbound call to the dialling manager', () => {
    expect(
      normalizeMoldcellEvent({
        cmd: 'event',
        type: 'OUTGOING',
        direction: 'out',
        callid: 'c1',
        user: 'denis_vasiliev@enso.pbx.moldcell.md',
      })?.answeredByLogin,
    ).toBe('denis_vasiliev');
  });

  it('should still mark inbound pushes as inbound', () => {
    expect(
      normalizeMoldcellEvent({
        cmd: 'event',
        type: 'INCOMING',
        direction: 'in',
        callid: 'c1',
      })?.direction,
    ).toBe('in');

    expect(
      normalizeMoldcellHistory({
        cmd: 'history',
        type: 'in',
        status: 'Success',
        callid: 'c1',
      })?.direction,
    ).toBe('in');

    // Roistat only ever tracks inbound, and a `contact` push only fires for an
    // arriving call — neither must ever be routed to the outbound leg.
    expect(normalizeRoistatCall({ id: 'r1' })?.direction).toBe('in');
    expect(
      normalizeMoldcellContact({ cmd: 'contact', callid: 'c1' })?.direction,
    ).toBe('in');
  });
});

describe('normalizeMoldcellContact', () => {
  it('should record the push without claiming any outcome', () => {
    // `contact` carries no status at all, so it must never look terminal or
    // authoritative — otherwise it would decide a deal's stage.
    const event = normalizeMoldcellContact({
      cmd: 'contact',
      phone: '37360177070',
      callid: 'IQD2TQ3R7S000035',
    });

    expect(event?.eventKey).toBe('moldcell:contact');
    expect(event?.isTerminal).toBe(false);
    expect(event?.isAuthoritativeOutcome).toBe(false);
    expect(event?.callStatus).toBeUndefined();
    expect(event?.callerE164).toBe('+37360177070');
  });

  it('should share the call id space with the other commands', () => {
    // All pushes about one call must correlate onto a single activity.
    const contact = normalizeMoldcellContact({ cmd: 'contact', callid: 'c1' });
    const history = normalizeMoldcellHistory({ cmd: 'history', callid: 'c1' });

    expect(contact?.externalId).toBe(history?.externalId);
    expect(contact?.eventKey).not.toBe(history?.eventKey);
  });

  it('should pick up a diversion if the PBX sends one, undocumented or not', () => {
    // The spec lists only cmd/phone/callid/crm_token, but live pushes have
    // already been seen carrying undocumented extras.
    const event = normalizeMoldcellContact({
      cmd: 'contact',
      phone: '068879173',
      callid: 'c1',
      diversion: '37376015220',
    } as Parameters<typeof normalizeMoldcellContact>[0]);

    expect(event?.calleeDid).toBe('37376015220');
    // And the DID then serves as the country hint for a national number.
    expect(event?.callerE164).toBe('+37368879173');
  });

  it('should return undefined without a callid', () => {
    expect(
      normalizeMoldcellContact({ cmd: 'contact', phone: '37360177070' }),
    ).toBeUndefined();
  });
});

describe('which pushes can decide a call outcome', () => {
  // The job may only create a deal from a push that knows the outcome. Being
  // terminal is not enough: `event COMPLETED` ends the call but carries no
  // status, and acting on it opened every answered call in ROUTING — the stage
  // meant for a call nobody took.
  it('should end the call on COMPLETED but report no status', () => {
    const event = normalizeMoldcellEvent({
      cmd: 'event',
      type: 'COMPLETED',
      callid: 'c1',
    });

    expect(event?.isTerminal).toBe(true);
    expect(event?.callStatus).toBeUndefined();
  });

  it('should let CANCELLED decide, since it implies nobody answered', () => {
    const event = normalizeMoldcellEvent({
      cmd: 'event',
      type: 'CANCELLED',
      callid: 'c1',
    });

    expect(event?.isTerminal).toBe(true);
    expect(event?.callStatus).toBe('ABANDONED');
  });

  it('should let history decide an answered call', () => {
    const event = normalizeMoldcellHistory({
      cmd: 'history',
      type: 'in',
      status: 'Success',
      callid: 'c1',
    });

    expect(event?.isTerminal).toBe(true);
    expect(event?.callStatus).toBe('ANSWERED');
  });

  it('should not let the ring-time pushes decide anything', () => {
    for (const type of ['INCOMING', 'ACCEPTED']) {
      const event = normalizeMoldcellEvent({
        cmd: 'event',
        type,
        callid: 'c1',
      });

      expect(event?.isTerminal).toBe(false);
    }

    expect(
      normalizeMoldcellContact({ cmd: 'contact', callid: 'c1' })?.isTerminal,
    ).toBe(false);
  });
});

// The outbound leg translates the phone-system vocabulary into the
// manager-achievement vocabulary, so an observed PBX call and a hand-logged one
// read the same. Every callStatus the normalizer can produce must map, or the
// outbound row silently loses its outcome.
describe('CALL_STATUS_TO_OUTBOUND_OUTCOME', () => {
  it('should map every status the Moldcell normalizer can produce', () => {
    const produced = new Set([
      ...Object.values(MOLDCELL_STATUS_TO_CALL_STATUS),
      // `event CANCELLED` sets this directly, without going through the map.
      'ABANDONED',
    ]);

    for (const status of produced) {
      expect(CALL_STATUS_TO_OUTBOUND_OUTCOME[status]).toBeDefined();
    }
  });

  it('should collapse every unreachable phone-system status to NO_ANSWER', () => {
    // From the manager's side there is no difference between "nobody picked up",
    // "we gave up" and "the network refused" — the touch simply did not land.
    expect(CALL_STATUS_TO_OUTBOUND_OUTCOME.UNANSWERED).toBe('NO_ANSWER');
    expect(CALL_STATUS_TO_OUTBOUND_OUTCOME.ABANDONED).toBe('NO_ANSWER');
    expect(CALL_STATUS_TO_OUTBOUND_OUTCOME.CONGESTION).toBe('NO_ANSWER');
  });

  it('should treat an answered call as REACHED and keep BUSY distinct', () => {
    expect(CALL_STATUS_TO_OUTBOUND_OUTCOME.ANSWERED).toBe('REACHED');
    expect(CALL_STATUS_TO_OUTBOUND_OUTCOME.BUSY).toBe('BUSY');
  });

  it('should only use outcomes the outboundActivity field accepts', () => {
    // The SELECT options, verified against the live workspace metadata.
    const allowed = [
      'REACHED',
      'NO_ANSWER',
      'BUSY',
      'VOICEMAIL',
      'WRONG_NUMBER',
      'CALLBACK_REQUESTED',
    ];

    for (const outcome of Object.values(CALL_STATUS_TO_OUTBOUND_OUTCOME)) {
      expect(allowed).toContain(outcome);
    }
  });
});
