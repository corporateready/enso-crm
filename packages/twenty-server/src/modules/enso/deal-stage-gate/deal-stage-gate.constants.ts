// The deal stage gate: what a deal must carry to sit in each stage. One list,
// read by every door into a stage — a manager moving the deal, the manual lead
// form (which asks for every stage up to the one the lead starts in) and,
// later, the stage-move popup — so the rule cannot drift between them.
// Spec: docs/sequencing-architecture.md "The stage gate".

// Forward order of the open stages. A deal moves forward one step at a time;
// moving back and closing are always allowed.
export const OPEN_DEAL_STAGES = [
  'ROUTING',
  'LEAD_CLAIMED',
  'CONNECTED',
  'DEEP_QUALIFICATION',
  'DEMO',
  'CONTRACTING',
] as const;

export const DEAL_STAGE_LABELS: Readonly<Record<string, string>> = {
  ROUTING: 'Routing',
  LEAD_CLAIMED: 'Lead Claimed',
  CONNECTED: 'Connected',
  DEEP_QUALIFICATION: 'Deep Qualification',
  DEMO: 'Demo',
  CONTRACTING: 'Contracting',
  CLOSED_WON: 'Closed Won',
  CLOSED_LOST: 'Closed Lost',
};

export type DealStageRequirement = {
  fieldName: string;
  label: string;
};

// Deep Qualification, Demo and Contracting have no required fields yet: their
// fields (sale/lease, asset type, budget, demo date…) are still being defined
// and do not exist on the deal. Adding them here gates every door at once.
export const DEAL_STAGE_REQUIREMENTS: Readonly<
  Record<string, readonly DealStageRequirement[]>
> = {
  // A claimed deal is one somebody owns — the sticky assignment needs it.
  LEAD_CLAIMED: [{ fieldName: 'ownerId', label: 'Owner' }],
  // Connected means two-way contact happened, so it is defined by when and how.
  CONNECTED: [
    { fieldName: 'firstContactAt', label: 'First contact date' },
    { fieldName: 'firstContactChannel', label: 'First contact channel' },
  ],
  CLOSED_LOST: [{ fieldName: 'lostReason', label: 'Lost reason' }],
};
