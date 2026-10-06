export type NewLeadDestination = 'MINE' | 'COLLEAGUE' | 'ROUTING';

export type NewLeadStartStage = 'LEAD_CLAIMED' | 'CONNECTED';

export type NewLeadFormValues = {
  projectId: string;
  firstName: string;
  lastName: string;
  phoneCallingCode: string;
  phoneNumber: string;
  email: string;
  manualLeadSourceId: string;
  referredByName: string;
  // datetime-local input values, read as the manager's local time.
  occurredAt: string;
  destination: NewLeadDestination;
  colleagueWorkspaceMemberId: string;
  startStage: NewLeadStartStage;
  firstContactAt: string;
  firstContactChannel: string;
  note: string;
  verbalConsentChannels: string[];
};

export type NewLeadDuplicateCheck = {
  verdict: 'NEW' | 'REUSE' | 'BLOCKED';
  displayName: string | null;
  maskedPhone: string | null;
  maskedEmail: string | null;
  ownerName: string | null;
  hasOpenDeal: boolean;
  isRateLimited: boolean;
};

export type ManualLeadSourceRecord = {
  id: string;
  name?: string | null;
  category?: string | null;
  projectId?: string | null;
};
