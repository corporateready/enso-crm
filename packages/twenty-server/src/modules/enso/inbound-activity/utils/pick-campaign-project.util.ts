import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';

export type CampaignProjectCandidate = {
  id: string;
  isUmbrella: boolean;
  utmCampaigns: string[];
};

type PickCampaignProjectArgs = {
  utmCampaign: unknown;
  currentProjectId: string | null | undefined;
  projects: CampaignProjectCandidate[];
};

// Decides whether a lead's utm_campaign should set its project.
//
// ENSO's campaign slugs name the project they promote, under marketing's own
// brand names: newton_buiucani_comercial_new_2025 IS Ioana Radu. That matters on
// the multi-project pages — Vânzări Imobiliare, ENSO Development MD and RO —
// where the inbox (or page) can only offer a catch-all default, so the campaign
// is the most specific statement of what the lead responded to.
//
// The rules, in order:
// - no campaign, or nobody claims it → leave the project alone;
// - two projects claim the same slug → leave it alone too: that is a data error,
//   and guessing between them would route a lead to the wrong manager, which is
//   worse than not routing it;
// - a campaign narrows an UMBRELLA project (or fills an empty one), but never
//   overrides a SPECIFIC one — a brand inbox, a mapped lead form or an ad's ref
//   already made an explicit decision, and a campaign is not more specific than
//   that.
//
// Returns the project to switch to, or undefined for "keep what you have".
export const pickCampaignProject = ({
  utmCampaign,
  currentProjectId,
  projects,
}: PickCampaignProjectArgs): string | undefined => {
  if (!isNonEmptyString(utmCampaign)) {
    return undefined;
  }

  const campaign = utmCampaign.trim();

  const claimants = projects.filter((project) =>
    project.utmCampaigns.some((slug) => slug.trim() === campaign),
  );

  if (claimants.length !== 1) {
    return undefined;
  }

  const [target] = claimants;

  if (target.id === currentProjectId) {
    return undefined;
  }

  if (isDefined(currentProjectId)) {
    const current = projects.find((project) => project.id === currentProjectId);

    // An unknown current project is treated as specific: we cannot prove it is a
    // catch-all, and overriding an explicit decision is the costly mistake.
    if (!isDefined(current) || !current.isUmbrella) {
      return undefined;
    }
  }

  return target.id;
};
