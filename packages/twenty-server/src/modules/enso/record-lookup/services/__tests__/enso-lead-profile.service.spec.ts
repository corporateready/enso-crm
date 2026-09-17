import { EnsoLeadProfileService } from 'src/modules/enso/record-lookup/services/enso-lead-profile.service';

// The profile exists so a scoped manager can open somebody else's lead without
// being able to work it. Two things therefore have to hold whatever the data
// looks like: the contact's details stay masked, and the stored deal name —
// which carries the phone number — never reaches the client.

const PERSON = {
  id: 'person-id',
  name: { firstName: 'Elena', lastName: 'Popescu' },
  phones: { primaryPhoneNumber: '69461016', primaryPhoneCallingCode: '+373' },
  emails: { primaryEmail: 'elena.popescu@gmail.com' },
  firstTouchAt: new Date('2026-03-12'),
};

const PROJECT = { id: 'project-id', name: 'ARTIMA', code: 'ENS1901' };

const OWNER = {
  id: 'owner-id',
  name: { firstName: 'Ioana', lastName: 'Radu' },
  userEmail: 'ioana@enso.ro',
};

const DEAL = {
  id: 'deal-id',
  pointOfContactId: PERSON.id,
  projectId: PROJECT.id,
  ownerId: OWNER.id,
  stage: 'DEEP_QUALIFICATION',
  source: 'CALL_INBOUND',
  name: 'Call | 69461016 | ARTIMA',
  firstContactAt: new Date('2026-03-12'),
  lastTouchAt: new Date('2026-09-14'),
  utmSource: 'meta',
  utmCampaign: 'artima_intro',
  firstTrafficType: 'PAID',
  reengagementCount: 2,
};

type Options = {
  isViewerScoped?: boolean;
  assignments?: unknown[];
  opportunities?: unknown[];
  person?: unknown;
};

const buildService = ({
  isViewerScoped = true,
  assignments = [
    {
      personId: PERSON.id,
      projectId: PROJECT.id,
      managerId: OWNER.id,
      assignedAt: new Date('2026-03-12'),
      lastContactAt: new Date('2026-09-14'),
    },
  ],
  opportunities = [DEAL],
  person = PERSON,
}: Options = {}) => {
  const bookReader = {
    runInWorkspaceContext: jest.fn((callback: () => unknown) => callback()),
    findOpportunityById: jest.fn().mockResolvedValue(DEAL),
    findPersonById: jest.fn().mockResolvedValue(person),
    findAssignmentsByPersonIds: jest.fn().mockResolvedValue(assignments),
    findOpportunitiesByPersonIds: jest.fn().mockResolvedValue(opportunities),
    findProjectsByIds: jest
      .fn()
      .mockResolvedValue(new Map([[PROJECT.id, PROJECT]])),
    findOwnersByIds: jest.fn().mockResolvedValue(new Map([[OWNER.id, OWNER]])),
    summarizeActivity: jest
      .fn()
      .mockResolvedValue({ count: 3, lastAt: new Date('2026-09-14') }),
  };

  const ensoPostHogService = { capture: jest.fn() };
  const ensoViewerScopeService = {
    isViewerScoped: jest.fn().mockResolvedValue(isViewerScoped),
  };

  const service = new EnsoLeadProfileService(
    bookReader as never,
    ensoPostHogService as never,
    ensoViewerScopeService as never,
  );

  return { service, bookReader, ensoPostHogService };
};

const profileParams = {
  workspaceId: 'workspace-id',
  workspaceMemberId: 'viewer-id',
  userWorkspaceId: 'user-workspace-id',
};

describe('EnsoLeadProfileService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should refuse to read anything when the viewer already sees every record', async () => {
    const { service, bookReader } = buildService({ isViewerScoped: false });

    const profile = await service.profile({
      ...profileParams,
      personId: PERSON.id,
    });

    expect(profile.isViewerScoped).toBe(false);
    expect(profile.isFound).toBe(false);
    expect(bookReader.runInWorkspaceContext).not.toHaveBeenCalled();
  });

  it('should name the owner and how to reach them while masking the contact', async () => {
    const { service } = buildService();

    const profile = await service.profile({
      ...profileParams,
      personId: PERSON.id,
    });

    expect(profile.isFound).toBe(true);
    expect(profile.displayName).toBe('Elena Popescu');
    expect(profile.maskedPhone).toBe('+373 ••• ••016');
    expect(profile.maskedEmail).toBe('e•••@gmail.com');
    expect(profile.isMine).toBe(false);
    expect(profile.projects).toHaveLength(1);
    expect(profile.projects[0]).toMatchObject({
      projectCode: 'ENS1901',
      ownerName: 'Ioana Radu',
      ownerEmail: 'ioana@enso.ro',
      dealStage: 'DEEP_QUALIFICATION',
      dealStatus: 'OPEN',
      utmCampaign: 'artima_intro',
      reengagementCount: 2,
    });
  });

  it('should describe the deal by its source, never by its stored name', async () => {
    const { service } = buildService();

    const profile = await service.profile({
      ...profileParams,
      opportunityId: DEAL.id,
    });

    expect(profile.projects[0].dealLabel).toBe('Call deal');
    expect(JSON.stringify(profile)).not.toContain(DEAL.name);
    expect(JSON.stringify(profile)).not.toContain('69461016');
  });

  it('should say a lead is unowned rather than claiming a colleague has it', async () => {
    const { service } = buildService({
      assignments: [
        {
          personId: PERSON.id,
          projectId: PROJECT.id,
          managerId: null,
          assignedAt: null,
          lastContactAt: null,
        },
      ],
      opportunities: [{ ...DEAL, ownerId: null }],
    });

    const profile = await service.profile({
      ...profileParams,
      personId: PERSON.id,
    });

    expect(profile.projects[0].ownerName).toBeNull();
    expect(profile.projects[0].ownerWorkspaceMemberId).toBeNull();
    expect(profile.isMine).toBe(false);
  });

  it('should mark the lead as belonging to the viewer when they hold the assignment', async () => {
    const { service } = buildService({
      assignments: [
        {
          personId: PERSON.id,
          projectId: PROJECT.id,
          managerId: 'viewer-id',
          assignedAt: new Date('2026-03-12'),
          lastContactAt: null,
        },
      ],
    });

    const profile = await service.profile({
      ...profileParams,
      personId: PERSON.id,
    });

    expect(profile.isMine).toBe(true);
  });

  it('should report an opened profile without recording who the lead is', async () => {
    const { service, ensoPostHogService } = buildService();

    await service.profile({ ...profileParams, personId: PERSON.id });

    expect(ensoPostHogService.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'lead_profile_opened',
        distinctId: 'viewer-id',
      }),
    );

    const [[captured]] = ensoPostHogService.capture.mock.calls;

    expect(JSON.stringify(captured)).not.toContain('Elena');
    expect(JSON.stringify(captured)).not.toContain('69461016');
  });

  it('should answer "not found" when the subject has been deleted', async () => {
    const { service } = buildService({ person: null });

    const profile = await service.profile({
      ...profileParams,
      personId: PERSON.id,
    });

    expect(profile.isFound).toBe(false);
    expect(profile.projects).toHaveLength(0);
  });
});
