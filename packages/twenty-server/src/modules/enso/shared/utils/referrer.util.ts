import { isNonEmptyString } from '@sniptt/guards';

// PostHog (website forms) and Roistat (dynamic call tracking) both report "the
// visitor arrived with no referring site" as the literal string `$direct`
// rather than as an absent value.
//
// `direct` IS a referrer as far as marketing is concerned — it says the visitor
// typed the address or came from somewhere untrackable, which is a different
// fact from "we never captured a referrer at all". So the value is kept, and
// only the `$` sentinel marker is dropped: nothing else we store or show uses a
// `$`-prefixed token, and leaking one reads as a broken tag.
const DIRECT_SENTINEL = '$direct';

export const DIRECT_REFERRER = 'direct';

export const normalizeReferrer = (
  value: string | null | undefined,
): string | undefined => {
  if (!isNonEmptyString(value)) {
    return undefined;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  return trimmed === DIRECT_SENTINEL ? DIRECT_REFERRER : trimmed;
};
