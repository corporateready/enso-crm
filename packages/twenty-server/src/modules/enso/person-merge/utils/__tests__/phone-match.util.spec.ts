import {
  arePhonesSameLine,
  phoneMatchCandidates,
  phoneShortlistSuffix,
} from 'src/modules/enso/person-merge/utils/phone-match.util';

// The numbers here are the shapes that actually occur in the workspace: a
// Moldovan national number with its calling code, the same line stored with
// '373' embedded (and a contradictory calling code, which is why the calling
// code is not consulted), and a trunk-zero form.

describe('arePhonesSameLine', () => {
  it('should match the same national number stored identically', () => {
    expect(arePhonesSameLine('68969113', '68969113')).toBe(true);
  });

  it('should match a national number against the same line with the country code embedded', () => {
    // '37368969113' is stored with primaryPhoneCallingCode '+40' in production;
    // it is still the same Moldovan line as '68969113'.
    expect(arePhonesSameLine('68969113', '37368969113')).toBe(true);
    expect(arePhonesSameLine('37368969113', '68969113')).toBe(true);
  });

  it('should match across a trunk zero', () => {
    expect(arePhonesSameLine('060123456', '60123456')).toBe(true);
    expect(arePhonesSameLine('060123456', '37360123456')).toBe(true);
  });

  it('should match a Romanian national number against its embedded form', () => {
    expect(arePhonesSameLine('785484545', '40785484545')).toBe(true);
  });

  it('should ignore formatting entirely', () => {
    expect(arePhonesSameLine('+373 60 123 456', '060123456')).toBe(true);
  });

  it('should REJECT a shorter number that is merely a suffix of a longer one', () => {
    // The false positive that soft-deleted real records: a 9-digit and a
    // 10-digit national number are different lines, and '2' is neither a trunk
    // zero nor a calling code that would explain the difference.
    expect(arePhonesSameLine('123456789', '2123456789')).toBe(false);
    expect(arePhonesSameLine('2123456789', '123456789')).toBe(false);
  });

  it('should reject two different lines that happen to share a long suffix', () => {
    expect(arePhonesSameLine('68969113', '768969113')).toBe(false);
  });

  it('should not strip a dial prefix when too little would be left to be a line', () => {
    // '401234567' happens to start with Romania's '40', but stripping it leaves
    // 7 digits — shorter than any national number here — so the value is taken
    // whole instead of being read as a prefixed '1234567'.
    expect(arePhonesSameLine('401234567', '1234567')).toBe(false);
    expect(arePhonesSameLine('3731234567', '1234567')).toBe(false);
    // With a full-length national part behind it, the prefix IS stripped.
    expect(arePhonesSameLine('40123456789', '123456789')).toBe(true);
  });

  it('should not match when either side has no usable number', () => {
    expect(arePhonesSameLine('', '68969113')).toBe(false);
    expect(arePhonesSameLine('68969113', null)).toBe(false);
    expect(arePhonesSameLine(undefined, undefined)).toBe(false);
    // Too short to be anyone's line — better a missed merge than a guess.
    expect(arePhonesSameLine('12345', '12345')).toBe(false);
  });
});

describe('phoneMatchCandidates', () => {
  it('should offer the national form alongside the stored form', () => {
    expect(phoneMatchCandidates('37368969113')).toEqual([
      '37368969113',
      '68969113',
    ]);
  });

  it('should strip a trunk zero', () => {
    expect(phoneMatchCandidates('068969113')).toEqual(['68969113']);
  });

  it('should return nothing for an unusable value', () => {
    expect(phoneMatchCandidates('')).toEqual([]);
    expect(phoneMatchCandidates('abc')).toEqual([]);
  });
});

describe('phoneShortlistSuffix', () => {
  it('should be the shortest candidate, so one LIKE catches every stored shape', () => {
    expect(phoneShortlistSuffix('37368969113')).toBe('68969113');
    expect(phoneShortlistSuffix('68969113')).toBe('68969113');
    expect(phoneShortlistSuffix('068969113')).toBe('68969113');
  });

  it('should be null when there is nothing to search on', () => {
    expect(phoneShortlistSuffix(null)).toBeNull();
  });

  // The shortlist has to be a superset of the true matches, or the confirmation
  // step never sees them. Every candidate is a suffix of the same digit string,
  // so the shortest one is a suffix of any form the same line can be stored in.
  it.each([
    ['68969113', '37368969113'],
    ['37368969113', '068969113'],
    ['060123456', '37360123456'],
    ['785484545', '40785484545'],
  ])('should shortlist %s so that %s is reachable', (trigger, stored) => {
    const suffix = phoneShortlistSuffix(trigger);

    expect(suffix).not.toBeNull();
    expect(stored.replace(/\D/g, '').endsWith(suffix as string)).toBe(true);
    expect(arePhonesSameLine(trigger, stored)).toBe(true);
  });
});
