import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';

import { OPPORTUNITY_SOURCE_LABEL } from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';
import {
  type MatchMode,
  type OpportunityRow,
  type PersonRow,
  type WorkspaceMemberRow,
} from 'src/modules/enso/record-lookup/services/enso-lead-book-reader.service';

const WON_STAGES = new Set(['CLOSED_WON']);
const LOST_STAGES = new Set(['CLOSED_LOST']);

export const resolveMatchMode = (searchTerm: string): MatchMode => {
  if (searchTerm.includes('@')) {
    return 'EMAIL';
  }

  const digits = searchTerm.replace(/\D/g, '');

  // A term that is mostly digits is a phone number, however it was pasted.
  return digits.length >= 5 && digits.length >= searchTerm.length - 4
    ? 'PHONE'
    : 'NAME';
};

export const buildDisplayName = (
  person: PersonRow | null | undefined,
): string =>
  [person?.name?.firstName, person?.name?.lastName]
    .filter(isNonEmptyString)
    .join(' ') || 'Unnamed contact';

export const buildOwnerName = (
  owner: WorkspaceMemberRow | null | undefined,
): string | null =>
  isDefined(owner)
    ? [owner.name?.firstName, owner.name?.lastName]
        .filter(isNonEmptyString)
        .join(' ') || null
    : null;

// The stored deal name is composite ("Call | 69… | ARTIMA") and carries the
// contact's phone number, so a projection never passes it on: the source alone
// says what kind of deal it is, which is all a colleague needs.
export const buildDealLabel = (source: string | null | undefined): string => {
  const label = isNonEmptyString(source)
    ? (OPPORTUNITY_SOURCE_LABEL[source] ?? null)
    : null;

  return isNonEmptyString(label) ? `${label} deal` : 'Deal';
};

export const resolveDealStatus = (opportunities: OpportunityRow[]): string => {
  if (opportunities.length === 0) {
    return 'NONE';
  }

  const stages = opportunities.map((row) => row.stage ?? '');

  if (
    stages.some((stage) => !WON_STAGES.has(stage) && !LOST_STAGES.has(stage))
  ) {
    return 'OPEN';
  }

  return stages.some((stage) => WON_STAGES.has(stage)) ? 'WON' : 'LOST';
};

export const earliest = (dates: (Date | null)[]): Date | null => {
  const defined = dates.filter(isDefined);

  return defined.length === 0
    ? null
    : defined.reduce((a, b) => (a < b ? a : b));
};

export const latest = (dates: (Date | null)[]): Date | null => {
  const defined = dates.filter(isDefined);

  return defined.length === 0
    ? null
    : defined.reduce((a, b) => (a > b ? a : b));
};
