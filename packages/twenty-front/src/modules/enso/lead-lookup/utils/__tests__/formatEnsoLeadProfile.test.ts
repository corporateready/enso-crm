import {
  formatActivityLine,
  formatDealLine,
} from '@/enso/lead-lookup/utils/formatEnsoLeadProfile';
import { type EnsoLeadProfileProject } from '@/enso/lead-lookup/hooks/useEnsoLeadProfile';

const buildProject = (
  overrides: Partial<EnsoLeadProfileProject> = {},
): EnsoLeadProfileProject => ({
  projectId: 'project-id',
  projectName: 'ARTIMA Business & Lifestyle',
  projectCode: 'ENS2301',
  ownerName: null,
  ownerEmail: null,
  ownerWorkspaceMemberId: null,
  isMine: false,
  firstContactAt: null,
  lastTouchAt: null,
  dealLabel: 'Form deal',
  dealStage: 'CONNECTED',
  dealStatus: 'OPEN',
  dealSource: 'FORM_WEBSITE',
  trafficType: 'PAID',
  utmSource: 'google',
  utmCampaign: 'brand_search_ro',
  reengagementCount: 0,
  ...overrides,
});

describe('formatDealLine', () => {
  it('should say how a live deal is going, stage then status', () => {
    expect(formatDealLine(buildProject())).toBe(
      'Form deal · Connected · deal open',
    );
  });

  it.each([
    ['CLOSED_LOST', 'LOST', 'Form deal · Closed lost'],
    ['CLOSED_WON', 'WON', 'Form deal · Closed won'],
  ])(
    'should not repeat itself when the stage already says how %s ended',
    (dealStage, dealStatus, expected) => {
      expect(formatDealLine(buildProject({ dealStage, dealStatus }))).toBe(
        expected,
      );
    },
  );

  it('should still name the status when there is no stage to carry it', () => {
    expect(
      formatDealLine(buildProject({ dealStage: null, dealStatus: 'NONE' })),
    ).toBe('Form deal · no deal');
  });
});

describe('formatActivityLine', () => {
  it('should return nothing when there has been no contact, so the caller can word it', () => {
    expect(formatActivityLine(0, null)).toBeNull();
  });

  it('should count the touches and date the last one', () => {
    expect(formatActivityLine(3, '2026-09-14T10:00:00.000Z')).toContain(
      '3 · last',
    );
  });
});
