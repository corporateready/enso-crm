import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';

import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

// The Dittofeed userId is always the CRM person UUID — the universal key.
// The CRM owns identity; Dittofeed never resolves or merges it.

export type MarketingSyncJobData =
  | {
      kind: 'identify';
      workspaceId: string;
      userId: string;
      traits: Record<string, unknown>;
      messageId: string;
    }
  | {
      kind: 'track';
      workspaceId: string;
      userId: string;
      event: string;
      properties: Record<string, unknown>;
      timestamp: string;
      messageId: string;
    };

// Track event names (Dittofeed journeys branch on these).
export const MARKETING_EVENT_DEAL_STAGE_CHANGED = 'deal_stage_changed';

// Compose an E.164 number from Twenty's PHONES composite. Returns undefined
// when there's no number. callingCode may or may not carry a leading '+'.
export const toE164 = (
  callingCode: string | null | undefined,
  number: string | null | undefined,
): string | undefined => {
  if (!isNonEmptyString(number)) {
    return undefined;
  }

  if (!isNonEmptyString(callingCode)) {
    return number;
  }

  const normalizedCallingCode = callingCode.startsWith('+')
    ? callingCode
    : `+${callingCode}`;

  return `${normalizedCallingCode}${number}`;
};

// Curated v1 trait set — only fields that currently exist on Person and that
// marketing segments / templates actually use. Grows as custom fields land
// (language, country, consent flags). Undefined values are dropped so we never
// clobber a Dittofeed trait with null.
export const buildPersonTraits = (
  person: PersonWorkspaceEntity,
): Record<string, unknown> => {
  const traits: Record<string, unknown> = {
    firstName: person.name?.firstName,
    lastName: person.name?.lastName,
    email: person.emails?.primaryEmail,
    phone: toE164(
      person.phones?.primaryPhoneCallingCode,
      person.phones?.primaryPhoneNumber,
    ),
    city: person.city,
    jobTitle: person.jobTitle,
    companyId: person.companyId,
    createdAt: person.createdAt,
  };

  return Object.fromEntries(
    Object.entries(traits).filter(([, value]) => isDefined(value)),
  );
};
