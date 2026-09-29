import { isNonEmptyString } from '@sniptt/guards';

// ENSO's utm_medium vocabulary is hand-authored, and the ad platforms that feed it
// do not always agree with it: the newton_buiucani message ads carry
// `paid_social_message_ad` in their url_tags while every other message ad carries
// the plural. A split medium silently halves a row in any BI grouping, so the
// canonical form is pinned here — the plural, matching its sibling
// `paid_social_leads_ad`, which is the most-used medium we have.
//
// Deliberately a fixed alias table, NOT a slugifier. Rewriting arbitrary values
// would quietly launder slugs we do not own; a genuinely new spelling should stay
// visible so someone notices and decides, rather than being smoothed away.
const UTM_MEDIUM_ALIASES: Record<string, string> = {
  paid_social_message_ad: 'paid_social_messages_ad',
};

export const canonicalizeUtmMedium = (value: unknown): unknown => {
  if (!isNonEmptyString(value)) {
    return value;
  }

  const trimmed = value.trim();

  return UTM_MEDIUM_ALIASES[trimmed] ?? value;
};

// Applies the alias to an activity payload, leaving every other field untouched.
// Returns the same object when there is nothing to change, so callers can keep
// their own no-op shortcuts.
export const withCanonicalUtmMedium = <T extends Record<string, unknown>>(
  data: T,
): T => {
  if (!('utmMedium' in data)) {
    return data;
  }

  const canonical = canonicalizeUtmMedium(data.utmMedium);

  return canonical === data.utmMedium
    ? data
    : { ...data, utmMedium: canonical };
};
