import { useQuery } from '@apollo/client/react';
import { useMemo } from 'react';
import { useDebounce } from 'use-debounce';
import { isDefined } from 'twenty-shared/utils';

import { ENSO_LEAD_LOOKUP } from '@/enso/lead-lookup/graphql/queries/ensoLeadLookup';
import { ENSO_LEAD_LOOKUP_MIN_TERM_LENGTH } from '@/enso/lead-lookup/constants/EnsoLeadLookupMinTermLength';

export type EnsoLeadLookupProject = {
  projectId: string | null;
  projectName: string | null;
  projectCode: string | null;
  ownerName: string | null;
  ownerWorkspaceMemberId: string | null;
  isMine: boolean;
  firstContactAt: string | null;
  lastTouchAt: string | null;
  dealStatus: string;
};

export type EnsoLeadLookupMatch = {
  personId: string;
  displayName: string;
  matchedOn: string;
  maskedPhone: string | null;
  maskedEmail: string | null;
  firstTouchAt: string | null;
  isMine: boolean;
  projects: EnsoLeadLookupProject[];
};

export type EnsoLeadLookupDealMatch = {
  opportunityId: string;
  dealLabel: string;
  personId: string | null;
  displayName: string;
  maskedPhone: string | null;
  maskedEmail: string | null;
  projectName: string | null;
  projectCode: string | null;
  ownerName: string | null;
  ownerWorkspaceMemberId: string | null;
  isMine: boolean;
  dealStatus: string;
  firstContactAt: string | null;
  lastTouchAt: string | null;
};

type EnsoLeadLookupData = {
  ensoLeadLookup: {
    isRateLimited: boolean;
    remainingLookupsToday: number;
    isViewerScoped: boolean;
    matches: EnsoLeadLookupMatch[];
    dealMatches: EnsoLeadLookupDealMatch[];
  };
};

// Only the matches worked by somebody else are surfaced: a manager's own
// contacts already come back through normal search, and showing them twice
// would read as a duplicate rather than as a warning.
export const useEnsoLeadLookup = (searchTerm: string | null) => {
  const [deferredSearchTerm] = useDebounce(searchTerm ?? '', 500);

  const { data, loading } = useQuery<EnsoLeadLookupData>(ENSO_LEAD_LOOKUP, {
    variables: { searchTerm: deferredSearchTerm },
    skip: deferredSearchTerm.trim().length < ENSO_LEAD_LOOKUP_MIN_TERM_LENGTH,
    // The allowance is spent server-side per call, so repeating a search must
    // not repeat the charge.
    fetchPolicy: 'cache-first',
  });

  const foreignMatches = useMemo(
    () => (data?.ensoLeadLookup.matches ?? []).filter((match) => !match.isMine),
    [data],
  );

  // A deal whose contact already appears above would read as the same lead
  // twice, so the contact line wins and the deal line only covers deals found
  // by name that belong to somebody the term did not match.
  const foreignDealMatches = useMemo(() => {
    const matchedPersonIds = new Set(
      (data?.ensoLeadLookup.matches ?? []).map((match) => match.personId),
    );

    return (data?.ensoLeadLookup.dealMatches ?? []).filter(
      (match) =>
        !match.isMine &&
        (!isDefined(match.personId) || !matchedPersonIds.has(match.personId)),
    );
  }, [data]);

  const isViewerScoped = data?.ensoLeadLookup.isViewerScoped ?? false;

  return {
    foreignMatches: isViewerScoped ? foreignMatches : [],
    foreignDealMatches: isViewerScoped ? foreignDealMatches : [],
    loading,
    isViewerScoped,
    // Only meaningful for a scoped viewer; an admin is never rate limited
    // because the lookup never runs for them.
    isRateLimited:
      isViewerScoped && (data?.ensoLeadLookup.isRateLimited ?? false),
    remainingLookupsToday: data?.ensoLeadLookup.remainingLookupsToday ?? 0,
  };
};
