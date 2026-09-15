import { buildPersonPhones } from 'src/modules/enso/telephony/utils/build-person-phones.util';

describe('buildPersonPhones', () => {
  it('should split a Moldovan caller exactly as before', () => {
    expect(buildPersonPhones('+37368879173')).toEqual({
      primaryPhoneNumber: '68879173',
      primaryPhoneCallingCode: '+373',
      primaryPhoneCountryCode: 'MD',
    });
  });

  it('should split a Romanian caller exactly as before', () => {
    expect(buildPersonPhones('+40785484545')).toEqual({
      primaryPhoneNumber: '785484545',
      primaryPhoneCallingCode: '+40',
      primaryPhoneCountryCode: 'RO',
    });
  });

  it('should now split a caller from outside MD/RO instead of storing the number whole', () => {
    // Both of these arrived last week and were stored as the full
    // international string with no calling code, which cannot compose into a
    // sendable number.
    expect(buildPersonPhones('+380977020236')).toEqual({
      primaryPhoneNumber: '977020236',
      primaryPhoneCallingCode: '+380',
      primaryPhoneCountryCode: 'UA',
    });
    expect(buildPersonPhones('+78121234567')).toEqual({
      primaryPhoneNumber: '8121234567',
      primaryPhoneCallingCode: '+7',
      primaryPhoneCountryCode: 'RU',
    });
  });

  it('should accept a number with no leading plus', () => {
    expect(buildPersonPhones('37368879173')).toEqual({
      primaryPhoneNumber: '68879173',
      primaryPhoneCallingCode: '+373',
      primaryPhoneCountryCode: 'MD',
    });
  });

  it('should keep the calling code when the country is ambiguous', () => {
    // A calling code shared by several countries that the number itself cannot
    // narrow down: no country, but the calling code still stands.
    const result = buildPersonPhones('+1234');

    expect(result?.primaryPhoneCallingCode).toBe('+1');
    expect(result?.primaryPhoneCountryCode).toBeUndefined();
  });

  it('should fall back to the prefix split rather than throw on a caller ID that is not a number', () => {
    // A PBX really does send these. libphonenumber throws on them, so the
    // fallback has to carry them, unchanged from the behaviour before this
    // split existed — an inbound call must still land on a record, and
    // refusing a suppressed number outright would lose the lead.
    expect(buildPersonPhones('anonymous')).toBeUndefined();
    expect(buildPersonPhones('')).toBeUndefined();
    expect(buildPersonPhones('+0')).toEqual({ primaryPhoneNumber: '0' });
  });

  it('should still produce a Moldovan composite for a number libphonenumber rejects', () => {
    // '+373' + too few digits fails validation but the prefix is unambiguous.
    expect(buildPersonPhones('+373123')).toEqual({
      primaryPhoneNumber: '123',
      primaryPhoneCallingCode: '+373',
      primaryPhoneCountryCode: 'MD',
    });
  });

  // The pairing that matters: whatever createPerson stores, findPersonByPhone
  // has to find again. It shortlists on this same primaryPhoneNumber, so the
  // stored number must be a suffix of the caller's full digit string — or a
  // second person is created on every call from that number.
  it.each([
    '+37368879173',
    '+40785484545',
    '+380977020236',
    '+78121234567',
    '+37360123456',
  ])('should store a number that is still findable for %s', (callerE164) => {
    const stored = buildPersonPhones(callerE164)?.primaryPhoneNumber;

    expect(stored).toBeDefined();
    expect(callerE164.replace(/\D/g, '').endsWith(stored as string)).toBe(true);
  });
});
