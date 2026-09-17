import { isDefined } from 'twenty-shared/utils';

import {
  type EnsoLeadLookupDealMatch,
  type EnsoLeadLookupMatch,
  type EnsoLeadLookupProject,
} from '@/enso/lead-lookup/hooks/useEnsoLeadLookup';

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

// The same line for a deal found by name. The stored deal name is never shown:
// it carries the contact's phone number.
export const formatEnsoLeadLookupDealSummary = (
  match: EnsoLeadLookupDealMatch,
) => {
  const project =
    match.projectCode ?? match.projectName ?? 'Unassigned project';
  const identity = match.maskedPhone ?? match.maskedEmail;

  return [`${project} · ${match.ownerName ?? 'unassigned'}`, identity]
    .filter(isDefined)
    .join(' — ');
};
