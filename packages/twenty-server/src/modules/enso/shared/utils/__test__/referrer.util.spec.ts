import {
  DIRECT_REFERRER,
  normalizeReferrer,
} from 'src/modules/enso/shared/utils/referrer.util';

describe('normalizeReferrer', () => {
  it('should keep a real referring URL untouched', () => {
    expect(normalizeReferrer('https://www.google.com/')).toBe(
      'https://www.google.com/',
    );
  });

  // `direct` is a real answer — the visitor came straight to the site — so it
  // is kept. Only the `$` sentinel marker is dropped.
  it('should keep a direct visit, without the sentinel marker', () => {
    expect(normalizeReferrer('$direct')).toBe(DIRECT_REFERRER);
    expect(normalizeReferrer('$direct')).not.toContain('$');
  });

  it('should treat a blank or missing referrer as unknown', () => {
    expect(normalizeReferrer(undefined)).toBeUndefined();
    expect(normalizeReferrer(null)).toBeUndefined();
    expect(normalizeReferrer('')).toBeUndefined();
    expect(normalizeReferrer('   ')).toBeUndefined();
  });

  it('should trim surrounding whitespace', () => {
    expect(normalizeReferrer('  https://l.instagram.com/  ')).toBe(
      'https://l.instagram.com/',
    );
  });
});
