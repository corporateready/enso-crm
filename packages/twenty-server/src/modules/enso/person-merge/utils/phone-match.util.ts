import {
  MOLDOVA_DIAL_PREFIX,
  ROMANIA_DIAL_PREFIX,
} from 'src/modules/enso/telephony/telephony.constants';

// Deciding whether two STORED phones are the same line, when the storage is
// genuinely inconsistent. All three of these shapes are live in production:
//
//   68969113    / +373   national number, calling code agrees
//   37368969113 / +40    country code embedded in the number, calling code WRONG
//   068879173   / +373   trunk zero kept
//
// 8.3% of phone rows (14 of 168) carry a calling code that contradicts the
// number, so `primaryPhoneCallingCode` is deliberately NOT an input here — the
// country prefix is inferred from the number's own digits, the way splitE164 in
// call-identity.service already does it.
//
// A blind "same last 9 digits" test is both too loose and too tight: it fuses
// '123456789' with '2123456789' (two different lines — neither is a prefixed
// form of the other, and that false positive really merged records away), while
// missing '68969113' against '37368969113', which IS one line.
//
// call-identity.service solves the same problem for an inbound call, but from a
// known full E.164 rather than row-vs-row. If the two ever converge, this moves
// to shared/utils alongside person-phone.util and takes the prefixes with it.

// Country codes a stored number may carry in front of its national part. Trunk
// zeros are handled separately, so this is dial prefixes only.
const DIAL_PREFIXES = [MOLDOVA_DIAL_PREFIX, ROMANIA_DIAL_PREFIX];

// Shorter than this and a value is too mangled to be anyone's line; we would
// rather miss a merge than guess.
const MIN_MATCHABLE_DIGITS = 7;

// A national number in the countries we operate in is 8 digits (MD) or 9 (RO).
// A dial prefix is only stripped when what remains is at least this long, so
// stripping can never manufacture a short collision — '40123456' stays whole
// instead of being read as '123456'.
const MIN_NATIONAL_DIGITS = 8;

const digitsOnly = (value: string | null | undefined): string =>
  String(value ?? '').replace(/\D/g, '');

// Every national form a stored number could plausibly be. Two phones are the
// same line exactly when these sets intersect.
export const phoneMatchCandidates = (
  storedNumber: string | null | undefined,
): string[] => {
  const digits = digitsOnly(storedNumber);

  // A trunk zero is a dialling artefact, never part of the line itself.
  const base = digits.replace(/^0+/, '');

  if (base.length < MIN_MATCHABLE_DIGITS) {
    return [];
  }

  const candidates = [base];

  for (const prefix of DIAL_PREFIXES) {
    if (!base.startsWith(prefix)) {
      continue;
    }

    const national = base.slice(prefix.length);

    if (national.length >= MIN_NATIONAL_DIGITS) {
      candidates.push(national);
    }
  }

  return candidates;
};

// The suffix the SQL shortlist should search on: the shortest candidate, so one
// LIKE catches the national rows AND the country-code-embedded rows. Every true
// match is guaranteed to end with it, because all candidates are suffixes of
// the same digit string. Null when the number is unmatchable.
export const phoneShortlistSuffix = (
  storedNumber: string | null | undefined,
): string | null => {
  const candidates = phoneMatchCandidates(storedNumber);

  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce((shortest, candidate) =>
    candidate.length < shortest.length ? candidate : shortest,
  );
};

// Whether two stored numbers are the same line.
export const arePhonesSameLine = (
  first: string | null | undefined,
  second: string | null | undefined,
): boolean => {
  const firstCandidates = phoneMatchCandidates(first);

  if (firstCandidates.length === 0) {
    return false;
  }

  const secondCandidates = new Set(phoneMatchCandidates(second));

  return firstCandidates.some((candidate) => secondCandidates.has(candidate));
};
