import { isDefined } from 'twenty-shared/utils';
import { isNonEmptyString } from '@sniptt/guards';

import { type EnsoLeadProfileProject } from '@/enso/lead-lookup/hooks/useEnsoLeadProfile';
import { beautifyExactDate } from '~/utils/date-utils';

// Stage and source reach the client as their raw keys (DEEP_QUALIFICATION,
// LEAD_AD) so the server never has to own presentation. This is the one place
// that turns them into something a manager reads.
export const humanizeEnumValue = (value: string | null | undefined) =>
  isNonEmptyString(value)
    ? value
        .toLowerCase()
        .split('_')
        .join(' ')
        .replace(/^./, (character) => character.toUpperCase())
    : null;

export const formatProfileDate = (value: string | null | undefined) =>
  isNonEmptyString(value) ? beautifyExactDate(value) : null;

export const formatProjectHeading = (project: EnsoLeadProfileProject) =>
  [project.projectCode, project.projectName]
    .filter(isNonEmptyString)
    .join(' · ') || 'Unassigned project';

export const formatDealLine = (project: EnsoLeadProfileProject) => {
  const stage = humanizeEnumValue(project.dealStage);
  const status =
    project.dealStatus === 'NONE'
      ? 'no deal'
      : `deal ${project.dealStatus.toLowerCase()}`;

  return [project.dealLabel, stage, status]
    .filter(isNonEmptyString)
    .join(' · ');
};

// Where the lead came from, in the order a manager reads it: what kind of
// inbound, how it was paid for, and which campaign slug carried it.
export const formatSourceLine = (project: EnsoLeadProfileProject) => {
  const parts = [
    humanizeEnumValue(project.dealSource),
    humanizeEnumValue(project.trafficType),
    [project.utmSource, project.utmCampaign]
      .filter(isNonEmptyString)
      .join(' / '),
  ].filter(isNonEmptyString);

  return parts.length === 0 ? null : parts.join(' · ');
};

// Null when there has been no contact at all, so the caller can say so in the
// viewer's own language rather than having it baked in here.
export const formatActivityLine = (
  count: number,
  lastAt: string | null,
): string | null => {
  if (count === 0) {
    return null;
  }

  const date = formatProfileDate(lastAt);

  return isDefined(date) ? `${count} · last ${date}` : `${count}`;
};
