import { parsePhoneNumberWithError } from 'libphonenumber-js';

import {
  MOLDOVA_CALLING_CODE,
  MOLDOVA_COUNTRY_CODE,
  MOLDOVA_DIAL_PREFIX,
  ROMANIA_CALLING_CODE,
  ROMANIA_COUNTRY_CODE,
  ROMANIA_DIAL_PREFIX,
} from 'src/modules/enso/telephony/telephony.constants';

// Twenty's PHONES composite: a national number with its calling code and ISO
// country kept in separate subfields.
export type PersonPhonesComposite = {
  primaryPhoneNumber: string;
  primaryPhoneCallingCode?: string;
  primaryPhoneCountryCode?: string;
};

const digitsOnly = (value: unknown): string =>
  String(value ?? '').replace(/\D/g, '');

// Split "+37368879173" into its country prefix and subscriber part. Knows only
// the two prefixes we operate on; the fallback for when libphonenumber cannot
// read the caller ID at all.
const splitE164 = (e164: string): { dialPrefix?: string; national: string } => {
  const digits = digitsOnly(e164);

  if (digits.startsWith(MOLDOVA_DIAL_PREFIX)) {
    return {
      dialPrefix: MOLDOVA_DIAL_PREFIX,
      national: digits.slice(MOLDOVA_DIAL_PREFIX.length),
    };
  }

  if (digits.startsWith(ROMANIA_DIAL_PREFIX)) {
    return {
      dialPrefix: ROMANIA_DIAL_PREFIX,
      national: digits.slice(ROMANIA_DIAL_PREFIX.length),
    };
  }

  return { national: digits };
};

// The composite to store for a caller, for ANY country.
//
// This used to recognise only the Moldovan and Romanian dial prefixes, so a
// caller from anywhere else was stored as the whole international number with
// NO calling code beside it — '380977020236' on its own. That is about 3% of
// the people the CRM creates from calls, and it leaves the row unable to
// compose a sendable number and harder to match against later.
//
// libphonenumber is already a server dependency and knows every calling code,
// so it does the split. It throws on a caller ID that is not a number at all
// ('anonymous', '+0'), which a PBX does send, so a failure falls back to the
// prefix logic rather than abandoning the person — an inbound call must always
// land on a record. A number that parses but is not "valid" is still split,
// because an odd caller ID is the PBX's to explain, not ours to discard.
export const buildPersonPhones = (
  callerE164: string,
): PersonPhonesComposite | undefined => {
  try {
    const parsed = parsePhoneNumberWithError(
      callerE164.startsWith('+') ? callerE164 : `+${digitsOnly(callerE164)}`,
    );

    if (parsed.nationalNumber && parsed.countryCallingCode) {
      return {
        primaryPhoneNumber: parsed.nationalNumber,
        primaryPhoneCallingCode: `+${parsed.countryCallingCode}`,
        // Undefined for a calling code shared by several countries that the
        // number itself cannot narrow down; the calling code still stands.
        ...(parsed.country ? { primaryPhoneCountryCode: parsed.country } : {}),
      };
    }
  } catch {
    // Fall through to the prefix logic below.
  }

  const { dialPrefix, national } = splitE164(callerE164);

  if (!national) {
    return undefined;
  }

  if (dialPrefix === MOLDOVA_DIAL_PREFIX) {
    return {
      primaryPhoneNumber: national,
      primaryPhoneCallingCode: MOLDOVA_CALLING_CODE,
      primaryPhoneCountryCode: MOLDOVA_COUNTRY_CODE,
    };
  }

  if (dialPrefix === ROMANIA_DIAL_PREFIX) {
    return {
      primaryPhoneNumber: national,
      primaryPhoneCallingCode: ROMANIA_CALLING_CODE,
      primaryPhoneCountryCode: ROMANIA_COUNTRY_CODE,
    };
  }

  return { primaryPhoneNumber: national };
};
