import { AUTHORITATIVE_CALL_EVENT_KEYS } from 'src/modules/enso/telephony/telephony.constants';

// Whether the push that states how a call actually went has landed for this row.
//
// Every push a call produces is kept in `submittedPayload` under its own
// eventKey, so their presence is the check. Until one of the authoritative keys
// is there, the row holds only what the individual legs claimed: a call that
// rings two extensions produces a CANCELLED for the one that lost the race, and
// none of the `event` pushes carries a duration.
//
// Read before restating a call's outcome, and before reporting it anywhere
// outside the CRM.
export const hasAuthoritativeCallPush = (
  submittedPayload: unknown,
): boolean => {
  const payload =
    typeof submittedPayload === 'object' && submittedPayload !== null
      ? (submittedPayload as Record<string, unknown>)
      : {};

  return AUTHORITATIVE_CALL_EVENT_KEYS.some((key) => key in payload);
};
