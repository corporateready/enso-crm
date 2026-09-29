import {
  CALL_OUTCOME_FALLBACK_MS,
  CALL_OUTCOME_SETTLE_MS,
} from 'src/modules/enso/telephony/telephony.constants';
import { type NormalizedCallEvent } from 'src/modules/enso/telephony/types/telephony.types';

export type CallOutcomeDecisionPlan = {
  jobId: string;
  delayMs: number;
};

// When to decide how an inbound call ended, given the push that just arrived.
//
// Only a closing push knows the call is over: Moldcell `history` or Roistat's
// after-call webhook, both of which fire once, after the call. A Moldcell `event`
// CANCELLED/COMPLETED looks final but is PER LEG. A department that rings its
// members in turn cancels one leg every few seconds while the call goes on, so
// deciding 20 s after the first of them decided a 136 s call two minutes early,
// from a provisional ABANDONED — the missed call then created no callback task,
// and an answer on a later leg opened its deal unowned in ROUTING.
//
// The two plans use different job ids on purpose. The closing push must not be
// swallowed by a fallback an earlier leg already armed, and whichever decision
// runs second finds the deal already linked and does nothing.
export const planCallOutcomeDecision = (
  activityId: string,
  event: Pick<NormalizedCallEvent, 'isTerminal' | 'isAuthoritativeOutcome'>,
): CallOutcomeDecisionPlan | undefined => {
  if (!event.isTerminal) {
    return undefined;
  }

  if (event.isAuthoritativeOutcome) {
    return {
      jobId: `enso-telephony-decide:${activityId}`,
      delayMs: CALL_OUTCOME_SETTLE_MS,
    };
  }

  // A leg ended. Keep a late decision in hand for the call whose closing push
  // never arrives, rather than deciding now from a leg.
  return {
    jobId: `enso-telephony-decide-fallback:${activityId}`,
    delayMs: CALL_OUTCOME_FALLBACK_MS,
  };
};
