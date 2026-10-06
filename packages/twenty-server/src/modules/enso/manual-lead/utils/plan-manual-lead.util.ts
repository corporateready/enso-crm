import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';

import { getCumulativeDealStageRequirements } from 'src/modules/enso/deal-stage-gate/utils/find-deal-stage-violation.util';
import {
  FIRST_CONTACT_CHANNELS,
  MANUAL_LEAD_DESTINATIONS,
  MANUAL_LEAD_FUTURE_TOLERANCE_MS,
  MANUAL_LEAD_START_STAGES,
  type ManualLeadDestination,
  VERBAL_CONSENT_CHANNELS,
} from 'src/modules/enso/manual-lead/manual-lead.constants';

export type ManualLeadPlanInput = {
  firstName?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  occurredAt?: Date | null;
  destination: string;
  colleagueWorkspaceMemberId?: string | null;
  startStage?: string | null;
  firstContactAt?: Date | null;
  firstContactChannel?: string | null;
  referredByPersonId?: string | null;
  referredByCompanyId?: string | null;
  referredByName?: string | null;
  verbalConsentChannels?: string[] | null;
};

export type ManualLeadPlan = {
  destination: ManualLeadDestination;
  stage: string;
  // Null when the lead goes to routing.
  ownerMemberId: string | null;
  firstContactAt: Date | null;
  firstContactChannel: string | null;
};

export type ManualLeadPlanResult =
  | { ok: true; plan: ManualLeadPlan }
  | { ok: false; error: string };

const fail = (error: string): ManualLeadPlanResult => ({ ok: false, error });

const isInFuture = (date: Date | null | undefined, now: Date): boolean =>
  isDefined(date) &&
  date.getTime() > now.getTime() + MANUAL_LEAD_FUTURE_TOLERANCE_MS;

// Turns what the manager filled in into where the deal starts, refusing
// anything the stage gate would refuse later. The required fields come from
// the same list the gate uses, so a hand-added lead can never sit in a stage
// without that stage's fields.
export const planManualLead = (
  input: ManualLeadPlanInput,
  context: {
    viewerWorkspaceMemberId: string;
    sourceCategory: string | null;
    now: Date;
  },
): ManualLeadPlanResult => {
  if (!isNonEmptyString(input.firstName?.trim())) {
    return fail('Add the lead’s first name.');
  }

  if (
    !isNonEmptyString(input.phoneNumber?.trim()) &&
    !isNonEmptyString(input.email?.trim())
  ) {
    return fail('Add a phone number or an email, so the lead can be reached.');
  }

  if (
    isInFuture(input.occurredAt, context.now) ||
    isInFuture(input.firstContactAt, context.now)
  ) {
    return fail('Dates can’t be in the future.');
  }

  if (
    (input.verbalConsentChannels ?? []).some(
      (channel) => !VERBAL_CONSENT_CHANNELS.includes(channel),
    )
  ) {
    return fail('Unknown consent channel.');
  }

  if (
    context.sourceCategory === 'REFERRAL' &&
    !isDefined(input.referredByPersonId) &&
    !isDefined(input.referredByCompanyId) &&
    !isNonEmptyString(input.referredByName?.trim())
  ) {
    return fail('Say who referred this lead.');
  }

  if (
    isDefined(input.firstContactChannel) &&
    !(FIRST_CONTACT_CHANNELS as readonly string[]).includes(
      input.firstContactChannel,
    )
  ) {
    return fail('Unknown first contact channel.');
  }

  if (
    !(MANUAL_LEAD_DESTINATIONS as readonly string[]).includes(input.destination)
  ) {
    return fail('Choose who works this lead.');
  }

  const destination = input.destination as ManualLeadDestination;

  if (destination === 'ROUTING') {
    return {
      ok: true,
      plan: {
        destination,
        stage: 'ROUTING',
        ownerMemberId: null,
        firstContactAt: null,
        firstContactChannel: null,
      },
    };
  }

  if (destination === 'COLLEAGUE') {
    if (!isNonEmptyString(input.colleagueWorkspaceMemberId)) {
      return fail('Choose the colleague who will work this lead.');
    }

    if (input.colleagueWorkspaceMemberId === context.viewerWorkspaceMemberId) {
      return fail('To keep the lead yourself, choose “Me”.');
    }

    // The colleague has not spoken to the lead yet, whatever the manager who
    // found it has, so their deal starts at Lead Claimed.
    return {
      ok: true,
      plan: {
        destination,
        stage: 'LEAD_CLAIMED',
        ownerMemberId: input.colleagueWorkspaceMemberId,
        firstContactAt: null,
        firstContactChannel: null,
      },
    };
  }

  const stage = input.startStage ?? 'LEAD_CLAIMED';

  if (!(MANUAL_LEAD_START_STAGES as readonly string[]).includes(stage)) {
    return fail('A lead you add can start at Lead Claimed or Connected.');
  }

  const deal: Record<string, unknown> = {
    ownerId: context.viewerWorkspaceMemberId,
    firstContactAt: input.firstContactAt ?? null,
    firstContactChannel: input.firstContactChannel ?? null,
  };

  const missing = getCumulativeDealStageRequirements(stage).filter(
    (requirement) => !isDefined(deal[requirement.fieldName]),
  );

  if (missing.length > 0) {
    return fail(
      `Fill in ${missing.map((requirement) => requirement.label).join(', ')} to start this lead at ${stage === 'CONNECTED' ? 'Connected' : 'Lead Claimed'}.`,
    );
  }

  return {
    ok: true,
    plan: {
      destination,
      stage,
      ownerMemberId: context.viewerWorkspaceMemberId,
      // Only a deal that starts Connected records its first contact; one that
      // starts at Lead Claimed is still waiting for it.
      firstContactAt:
        stage === 'CONNECTED' ? (input.firstContactAt ?? null) : null,
      firstContactChannel:
        stage === 'CONNECTED' ? (input.firstContactChannel ?? null) : null,
    },
  };
};
