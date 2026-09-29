import {
  CALL_OUTCOME_FALLBACK_MS,
  CALL_OUTCOME_SETTLE_MS,
} from 'src/modules/enso/telephony/telephony.constants';
import { type MoldcellEventPush } from 'src/modules/enso/telephony/types/telephony.types';
import {
  normalizeMoldcellEvent,
  normalizeMoldcellHistory,
  normalizeRoistatCall,
} from 'src/modules/enso/telephony/utils/normalize-call-event.util';
import { planCallOutcomeDecision } from 'src/modules/enso/telephony/utils/plan-call-outcome-decision.util';

const ACTIVITY_ID = '5ea7a554-77a9-4caf-b6df-9656a76c511b';

// Pushes of one real call (NEP847ASHK000037, 2026-09-29): ARTIMA rang Sergiu and
// Alexandr in turn for 136 s and nobody picked up. Its first CANCELLED arrived
// at 12:50:56 and its history at 12:53:03.
const legPush = (type: string, user: string): MoldcellEventPush => ({
  cmd: 'event',
  type,
  user,
  phone: '37369453003',
  callid: 'NEP847ASHK000037',
  diversion: '37376040824',
  direction: 'in',
});

const requireEvent = <TEvent>(event: TEvent | undefined): TEvent => {
  if (event === undefined) {
    throw new Error('push did not normalize');
  }

  return event;
};

describe('planCallOutcomeDecision', () => {
  it('should not decide while the call is still ringing', () => {
    const incoming = requireEvent(
      normalizeMoldcellEvent(legPush('INCOMING', 'sergiu_surjco')),
    );

    expect(planCallOutcomeDecision(ACTIVITY_ID, incoming)).toBeUndefined();
  });

  it('should only arm the late fallback when one leg of a department call is cancelled', () => {
    const cancelledLeg = requireEvent(
      normalizeMoldcellEvent(legPush('CANCELLED', 'sergiu_surjco')),
    );

    expect(planCallOutcomeDecision(ACTIVITY_ID, cancelledLeg)).toEqual({
      jobId: `enso-telephony-decide-fallback:${ACTIVITY_ID}`,
      delayMs: CALL_OUTCOME_FALLBACK_MS,
    });
  });

  it('should treat a completed leg as provisional too', () => {
    const completedLeg = requireEvent(
      normalizeMoldcellEvent(legPush('COMPLETED', 'oleg_luchian')),
    );

    expect(planCallOutcomeDecision(ACTIVITY_ID, completedLeg)?.jobId).toBe(
      `enso-telephony-decide-fallback:${ACTIVITY_ID}`,
    );
  });

  it('should decide shortly after the history push closes the call', () => {
    const history = requireEvent(
      normalizeMoldcellHistory({
        cmd: 'history',
        type: 'in',
        user: 'pbx',
        phone: '37369453003',
        start: '20260929T125046Z',
        callid: 'NEP847ASHK000037',
        status: 'missed',
        duration: '136',
        diversion: '37376040824',
        missedStatus: '3',
      }),
    );

    expect(planCallOutcomeDecision(ACTIVITY_ID, history)).toEqual({
      jobId: `enso-telephony-decide:${ACTIVITY_ID}`,
      delayMs: CALL_OUTCOME_SETTLE_MS,
    });
  });

  it('should decide shortly after a Roistat after-call webhook, not after its at-call one', () => {
    const atCall = requireEvent(
      normalizeRoistatCall({
        id: '108157690',
        caller: '37369453003',
        callee: '37376040824',
        date: '2026-09-29 12:50:48',
      }),
    );
    const afterCall = requireEvent(
      normalizeRoistatCall({
        id: '108157690',
        caller: '37369453003',
        callee: '37376040824',
        date: '2026-09-29 12:50:48',
        status: 'NOANSWER',
        duration: 136,
      }),
    );

    expect(planCallOutcomeDecision(ACTIVITY_ID, atCall)).toBeUndefined();
    expect(planCallOutcomeDecision(ACTIVITY_ID, afterCall)?.jobId).toBe(
      `enso-telephony-decide:${ACTIVITY_ID}`,
    );
  });

  it('should give the closing decision and the fallback different job ids', () => {
    // Same id would let the fallback armed by the first leg swallow the
    // closing push's decision, which is the bug this plan exists to prevent.
    const fallback = planCallOutcomeDecision(ACTIVITY_ID, {
      isTerminal: true,
      isAuthoritativeOutcome: false,
    });
    const closing = planCallOutcomeDecision(ACTIVITY_ID, {
      isTerminal: true,
      isAuthoritativeOutcome: true,
    });

    expect(fallback?.jobId).not.toBe(closing?.jobId);
    expect(CALL_OUTCOME_FALLBACK_MS).toBeGreaterThan(136 * 1000);
  });
});
