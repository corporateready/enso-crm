import {
  canonicalizeUtmMedium,
  withCanonicalUtmMedium,
} from 'src/modules/enso/inbound-activity/utils/canonicalize-utm-medium.util';

describe('canonicalizeUtmMedium', () => {
  it('should fold the singular message-ad medium into the canonical plural', () => {
    expect(canonicalizeUtmMedium('paid_social_message_ad')).toBe(
      'paid_social_messages_ad',
    );
  });

  it('should leave the canonical form alone', () => {
    expect(canonicalizeUtmMedium('paid_social_messages_ad')).toBe(
      'paid_social_messages_ad',
    );
  });

  it('should not touch a medium it has no alias for', () => {
    // A new spelling must stay visible rather than be laundered into something
    // that looks right — that is how the split gets noticed and decided.
    expect(canonicalizeUtmMedium('paid_social_msg_ad')).toBe(
      'paid_social_msg_ad',
    );
    expect(canonicalizeUtmMedium('paid_social_leads_ad')).toBe(
      'paid_social_leads_ad',
    );
  });

  it('should pass through anything that is not a usable string', () => {
    expect(canonicalizeUtmMedium(undefined)).toBeUndefined();
    expect(canonicalizeUtmMedium(null)).toBeNull();
    expect(canonicalizeUtmMedium('')).toBe('');
  });

  it('should match on a padded value without rewriting the stored one', () => {
    expect(canonicalizeUtmMedium(' paid_social_message_ad ')).toBe(
      'paid_social_messages_ad',
    );
  });

  it('should leave a payload without utmMedium untouched', () => {
    const data = { kind: 'SOCIAL_MESSAGE' };

    expect(withCanonicalUtmMedium(data)).toBe(data);
  });

  it('should return the same object when nothing needs changing', () => {
    const data = { utmMedium: 'paid_social_messages_ad' };

    expect(withCanonicalUtmMedium(data)).toBe(data);
  });

  it('should rewrite only utmMedium on a payload that needs it', () => {
    const data = {
      utmMedium: 'paid_social_message_ad',
      utmCampaign: 'newton_buiucani_comercial_new_2025',
    };

    expect(withCanonicalUtmMedium(data)).toEqual({
      utmMedium: 'paid_social_messages_ad',
      utmCampaign: 'newton_buiucani_comercial_new_2025',
    });
  });
});
