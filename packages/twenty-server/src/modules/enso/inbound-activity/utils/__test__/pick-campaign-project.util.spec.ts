import {
  type CampaignProjectCandidate,
  pickCampaignProject,
} from 'src/modules/enso/inbound-activity/utils/pick-campaign-project.util';

const IOANA_RADU = 'ioana-radu';
const ARTIMA = 'artima';
const VANZARI = 'vanzari';
const ENSO_ESTATE = 'enso-estate';

const PROJECTS: CampaignProjectCandidate[] = [
  {
    id: IOANA_RADU,
    isUmbrella: false,
    utmCampaigns: ['newton_buiucani_comercial_new_2025'],
  },
  { id: ARTIMA, isUmbrella: false, utmCampaigns: [] },
  { id: VANZARI, isUmbrella: true, utmCampaigns: [] },
  { id: ENSO_ESTATE, isUmbrella: true, utmCampaigns: [] },
];

const pick = (utmCampaign: unknown, currentProjectId: string | null) =>
  pickCampaignProject({ utmCampaign, currentProjectId, projects: PROJECTS });

describe('pickCampaignProject', () => {
  it('should route a mapped campaign that arrived with no project', () => {
    expect(pick('newton_buiucani_comercial_new_2025', null)).toBe(IOANA_RADU);
  });

  it('should narrow the Vânzări catch-all to the project the campaign names', () => {
    expect(pick('newton_buiucani_comercial_new_2025', VANZARI)).toBe(
      IOANA_RADU,
    );
  });

  it('should narrow the ENSO Development umbrella the same way', () => {
    expect(pick('newton_buiucani_comercial_new_2025', ENSO_ESTATE)).toBe(
      IOANA_RADU,
    );
  });

  it('should never override a specific project', () => {
    // A brand inbox, a mapped lead form or an ad ref already decided.
    expect(pick('newton_buiucani_comercial_new_2025', ARTIMA)).toBeUndefined();
  });

  it('should leave the project alone when the campaign is unmapped', () => {
    expect(pick('some_new_campaign', VANZARI)).toBeUndefined();
    expect(pick('some_new_campaign', null)).toBeUndefined();
  });

  it('should report no change when the lead is already on the mapped project', () => {
    expect(
      pick('newton_buiucani_comercial_new_2025', IOANA_RADU),
    ).toBeUndefined();
  });

  it('should refuse to route when two projects claim the same campaign', () => {
    const contested: CampaignProjectCandidate[] = [
      ...PROJECTS,
      {
        id: 'other',
        isUmbrella: false,
        utmCampaigns: ['newton_buiucani_comercial_new_2025'],
      },
    ];

    expect(
      pickCampaignProject({
        utmCampaign: 'newton_buiucani_comercial_new_2025',
        currentProjectId: VANZARI,
        projects: contested,
      }),
    ).toBeUndefined();
  });

  it('should treat an unknown current project as specific', () => {
    expect(
      pick('newton_buiucani_comercial_new_2025', 'deleted-project'),
    ).toBeUndefined();
  });

  it('should match a padded campaign value', () => {
    expect(pick('  newton_buiucani_comercial_new_2025 ', null)).toBe(
      IOANA_RADU,
    );
  });

  it('should ignore a missing or non-string campaign', () => {
    expect(pick(undefined, VANZARI)).toBeUndefined();
    expect(pick('', VANZARI)).toBeUndefined();
    expect(pick(null, VANZARI)).toBeUndefined();
  });
});
