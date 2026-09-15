import {
  readPersonPhoneE164,
  toE164,
} from 'src/modules/enso/shared/utils/person-phone.util';

describe('toE164', () => {
  it('should prepend the calling code with a plus', () => {
    expect(toE164('+373', '69143382')).toBe('+37369143382');
  });

  it('should add the missing plus when the calling code has none', () => {
    expect(toE164('373', '69143382')).toBe('+37369143382');
  });

  it('should return the bare number when there is no calling code', () => {
    expect(toE164(undefined, '69143382')).toBe('69143382');
    expect(toE164('', '69143382')).toBe('69143382');
  });

  // Every number below is a shape that is actually stored in the workspace.
  describe('when the two halves disagree', () => {
    it('should trust the number when it already carries its country code', () => {
      // 14 live rows hold a Moldovan number stamped with Romania's +40. Stapling
      // them together produced '+4037368969113', which was then handed to the
      // SMS provider and to the marketing identity feed.
      expect(toE164('+40', '37368969113')).toBe('+37368969113');
      expect(toE164('+373', '37368969113')).toBe('+37368969113');
    });

    it('should still produce a valid number when there is no calling code at all', () => {
      // A caller outside MD/RO is stored by call-identity with the full
      // international number and no calling code.
      expect(toE164(undefined, '380977020236')).toBe('+380977020236');
      expect(toE164('', '78121234567')).toBe('+78121234567');
    });

    it('should drop a trunk zero instead of embedding it', () => {
      expect(toE164('+373', '060123456')).toBe('+37360123456');
    });

    it('should ignore formatting in either half', () => {
      expect(toE164('+373', '69 143 382')).toBe('+37369143382');
      expect(toE164('(373)', '69143382')).toBe('+37369143382');
    });

    it('should leave a short number alone when there is no calling code to add', () => {
      // Display paths (deal names, notifications) still want the digits rather
      // than nothing; they simply cannot be made international here.
      expect(toE164(undefined, '69143382')).toBe('69143382');
    });
  });

  it('should return undefined when there is no number', () => {
    // primaryPhoneNumber defaults to '' rather than null for phone-less people
    // (social contacts), so the empty string has to count as absent.
    expect(toE164('+373', '')).toBeUndefined();
    expect(toE164('+373', null)).toBeUndefined();
  });
});

describe('readPersonPhoneE164', () => {
  it('should compose both halves of the PHONES composite', () => {
    expect(
      readPersonPhoneE164({
        phones: {
          primaryPhoneNumber: '69143382',
          primaryPhoneCallingCode: '+373',
        },
      }),
    ).toBe('+37369143382');
  });

  it('should return undefined for a person with no phone', () => {
    expect(
      readPersonPhoneE164({
        phones: { primaryPhoneNumber: '', primaryPhoneCallingCode: '' },
      }),
    ).toBeUndefined();
    expect(readPersonPhoneE164({ phones: null })).toBeUndefined();
    expect(readPersonPhoneE164(null)).toBeUndefined();
  });
});
