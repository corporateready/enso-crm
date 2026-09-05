import { isDefined } from 'twenty-shared/utils';

import {
  type EnsoLeadLookupMatch,
  type EnsoLeadLookupProject,
} from '@/enso/lead-lookup/hooks/useEnsoLeadLookup';
import { beautifyExactDate } from '~/utils/date-utils';

const formatProjectName = (project: EnsoLeadLookupProject) =>
  project.projectCode ?? project.projectName ?? 'Unassigned project';

// One line, because this sits in a search result list: who has it and where.
export const formatEnsoLeadLookupSummary = (match: EnsoLeadLookupMatch) => {
  const owners = [
    ...new Set(
      match.projects.map(
        (project) =>
          `${formatProjectName(project)} · ${project.ownerName ?? 'unassigned'}`,
      ),
    ),
  ];

  const identity = match.maskedPhone ?? match.maskedEmail;

  return [owners.join(' · '), identity].filter(isDefined).join(' — ');
};

// The full picture, shown when a manager clicks through: enough to decide
// whether to leave it alone or go and talk to the owner.
export const formatEnsoLeadLookupDetails = (match: EnsoLeadLookupMatch) => {
  if (match.projects.length === 0) {
    return `${match.displayName} is in the CRM but not assigned to anyone yet.`;
  }

  const lines = match.projects.map((project) => {
    const since = isDefined(project.firstContactAt)
      ? ` since ${beautifyExactDate(project.firstContactAt)}`
      : '';
    const lastTouch = isDefined(project.lastTouchAt)
      ? `, last touched ${beautifyExactDate(project.lastTouchAt)}`
      : '';
    const status =
      project.dealStatus === 'NONE'
        ? 'no deal'
        : `deal ${project.dealStatus.toLowerCase()}`;

    return `${formatProjectName(project)}: ${
      project.ownerName ?? 'unassigned'
    }${since}${lastTouch} (${status})`;
  });

  return `${match.displayName} — ${lines.join(' | ')}`;
};
