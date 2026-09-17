import { useQuery } from '@apollo/client/react';

import { ENSO_LEAD_PROFILE } from '@/enso/lead-lookup/graphql/queries/ensoLeadProfile';
import { type EnsoLeadProfileSubject } from '@/enso/lead-lookup/types/EnsoLeadProfileSubject';
import { isDefined } from 'twenty-shared/utils';

export type EnsoLeadProfileProject = {
  projectId: string | null;
  projectName: string | null;
  projectCode: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerWorkspaceMemberId: string | null;
  isMine: boolean;
  firstContactAt: string | null;
  lastTouchAt: string | null;
  dealLabel: string | null;
  dealStage: string | null;
  dealStatus: string;
  dealSource: string | null;
  trafficType: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  reengagementCount: number;
};

export type EnsoLeadProfileActivity = {
  inboundCount: number;
  outboundCount: number;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
};

export type EnsoLeadProfile = {
  isFound: boolean;
  isViewerScoped: boolean;
  personId: string | null;
  displayName: string;
  maskedPhone: string | null;
  maskedEmail: string | null;
  firstTouchAt: string | null;
  isMine: boolean;
  projects: EnsoLeadProfileProject[];
  activity: EnsoLeadProfileActivity;
};

type EnsoLeadProfileData = { ensoLeadProfile: EnsoLeadProfile };

export const useEnsoLeadProfile = (subject: EnsoLeadProfileSubject | null) => {
  const { data, loading } = useQuery<EnsoLeadProfileData>(ENSO_LEAD_PROFILE, {
    variables: {
      personId: subject?.personId ?? null,
      opportunityId: subject?.opportunityId ?? null,
    },
    skip: !isDefined(subject),
    // Nothing here is editable, and reopening the same lead within a session
    // should not re-enter the audit trail as a second look.
    fetchPolicy: 'cache-first',
  });

  return {
    profile: data?.ensoLeadProfile ?? null,
    loading,
  };
};
