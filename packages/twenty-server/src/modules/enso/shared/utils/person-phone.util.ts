import { isNonEmptyString } from '@sniptt/guards';

// Twenty stores a phone as a PHONES composite: the subscriber number and its
// calling code are SEPARATE subfields. Reading `primaryPhoneNumber` alone
// therefore yields a national number with no country — which is how a Moldovan
// caller reached the marketing rooms as "Client Number: 69143382" and the deal
// as "Deal | 69143382 | ARTIMA", both unusable for calling back or for matching
// against the +373 form the activity and the PBX already use.
//
// Every place that DISPLAYS or SENDS a person's phone must compose both halves,
// so the composition lives here once.
//
// The catch: the two halves can DISAGREE. Some rows keep the country code
// inside primaryPhoneNumber next to a calling code that contradicts it — 14
// live rows hold a Moldovan '373…' number stamped '+40'/RO — and rows created
// from a call by a caller outside MD/RO carry no calling code at all. Stapling
// the halves together unconditionally turned those into '+4037368969113' and
// '380977020236', neither of which is a number; both go straight to the SMS
// recipient field and to the marketing identity feed, which check only that
// something is there.

// At or above this many digits a number already carries its own country code,
// so it is taken whole and the stored calling code is ignored. 11 is safe here:
// a national number is 8 digits in Moldova and 9 in Romania.
export const INTERNATIONAL_PHONE_DIGITS = 11;

// Compose an E.164 number from Twenty's PHONES composite. Returns undefined
// when there's no number. callingCode may or may not carry a leading '+'.
export const toE164 = (
  callingCode: string | null | undefined,
  number: string | null | undefined,
): string | undefined => {
  if (!isNonEmptyString(number)) {
    return undefined;
  }

  const numberDigits = number.replace(/\D/g, '');

  if (numberDigits.length === 0) {
    return undefined;
  }

  // Already international — trust the number over the calling code.
  if (numberDigits.length >= INTERNATIONAL_PHONE_DIGITS) {
    return `+${numberDigits}`;
  }

  if (!isNonEmptyString(callingCode)) {
    return numberDigits;
  }

  const callingCodeDigits = callingCode.replace(/\D/g, '');

  if (callingCodeDigits.length === 0) {
    return numberDigits;
  }

  // A trunk zero is a dialling artefact and never part of the E.164 form.
  return `+${callingCodeDigits}${numberDigits.replace(/^0+/, '')}`;
};

type PersonWithPhones = {
  phones?: {
    primaryPhoneNumber?: string | null;
    primaryPhoneCallingCode?: string | null;
  } | null;
} | null;

// The composite read every display path wants. Kept separate from `toE164` so
// callers holding a loosely typed person row (the ORM repositories in these
// modules are `any`) do not each re-spell the two subfield names.
export const readPersonPhoneE164 = (
  person: PersonWithPhones,
): string | undefined =>
  toE164(
    person?.phones?.primaryPhoneCallingCode,
    person?.phones?.primaryPhoneNumber,
  );
