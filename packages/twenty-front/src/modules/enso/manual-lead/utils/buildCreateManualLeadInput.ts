import { type NewLeadFormValues } from '@/enso/manual-lead/types/NewLeadFormValues';

const orUndefined = (value: string) => {
  const trimmed = value.trim();

  return trimmed === '' ? undefined : trimmed;
};

const toIsoOrUndefined = (value: string) =>
  value === '' ? undefined : new Date(value).toISOString();

// The form keeps every section's values while the manager switches between
// options; only what the chosen options mean is sent.
export const buildCreateManualLeadInput = (
  values: NewLeadFormValues,
  requestId: string,
) => {
  const keepsLead = values.destination === 'MINE';
  const isConnected = keepsLead && values.startStage === 'CONNECTED';

  return {
    requestId,
    projectId: values.projectId,
    firstName: values.firstName.trim(),
    lastName: orUndefined(values.lastName),
    phoneNumber: orUndefined(values.phoneNumber),
    phoneCallingCode: orUndefined(values.phoneNumber)
      ? values.phoneCallingCode
      : undefined,
    email: orUndefined(values.email),
    manualLeadSourceId: values.manualLeadSourceId,
    referredByName: orUndefined(values.referredByName),
    occurredAt: toIsoOrUndefined(values.occurredAt),
    destination: values.destination,
    colleagueWorkspaceMemberId:
      values.destination === 'COLLEAGUE'
        ? orUndefined(values.colleagueWorkspaceMemberId)
        : undefined,
    startStage: keepsLead ? values.startStage : undefined,
    firstContactAt: isConnected
      ? toIsoOrUndefined(values.firstContactAt)
      : undefined,
    firstContactChannel: isConnected ? values.firstContactChannel : undefined,
    note: orUndefined(values.note),
    verbalConsentChannels: values.verbalConsentChannels,
  };
};
