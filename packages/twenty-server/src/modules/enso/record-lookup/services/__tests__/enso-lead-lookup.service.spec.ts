import { ENSO_LEAD_LOOKUP_DAILY_ALLOWANCE } from 'src/modules/enso/record-lookup/enso-lead-lookup.constants';
import { EnsoLeadLookupService } from 'src/modules/enso/record-lookup/services/enso-lead-lookup.service';

// Searching a deal name used to return nothing at all to a scoped manager, and
// a deal name is the one thing that cannot be shown back to them: it is built
// from the contact's phone number.

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
  stage: 'CONNECTED',
  source: 'CALL_INBOUND',
  name: 'Call | 69461016 | ARTIMA',
  firstContactAt: new Date('2026-03-12'),
  lastTouchAt: new Date('2026-09-14'),
};

type Options = {
  people?: unknown[];
  matchedDeals?: unknown[];
  usedAllowance?: number;
};

const buildService = ({
  people = [],
  matchedDeals = [DEAL],
  usedAllowance = 0,
}: Options = {}) => {
  const bookReader = {
    runInWorkspaceContext: jest.fn((callback: () => unknown) => callback()),
    findPeopleBySearchTerm: jest.fn().mockResolvedValue(people),
    findOpportunitiesBySearchTerm: jest.fn().mockResolvedValue(matchedDeals),
    findPeopleByIds: jest.fn().mockResolvedValue([PERSON]),
    findAssignmentsByPersonIds: jest.fn().mockResolvedValue([]),
    findOpportunitiesByPersonIds: jest.fn().mockResolvedValue([]),
    findProjectsByIds: jest
      .fn()
      .mockResolvedValue(new Map([[PROJECT.id, PROJECT]])),
    findOwnersByIds: jest.fn().mockResolvedValue(new Map([[OWNER.id, OWNER]])),
  };

  const cacheStorage = {
    get: jest.fn().mockResolvedValue(usedAllowance),
    set: jest.fn().mockResolvedValue(undefined),
  };

  const service = new EnsoLeadLookupService(
    bookReader as never,
    { capture: jest.fn() } as never,
    { isViewerScoped: jest.fn().mockResolvedValue(true) } as never,
    cacheStorage as never,
  );

  return { service, bookReader };
};

const lookupParams = {
  workspaceId: 'workspace-id',
  workspaceMemberId: 'viewer-id',
  userWorkspaceId: 'user-workspace-id',
};

describe('EnsoLeadLookupService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return a deal found by name without echoing the name back', async () => {
    const { service } = buildService();

    const result = await service.lookup({
      ...lookupParams,
      searchTerm: 'ARTIMA',
    });

    expect(result.dealMatches).toHaveLength(1);
    expect(result.dealMatches[0]).toMatchObject({
      opportunityId: 'deal-id',
      dealLabel: 'Call deal',
      displayName: 'Elena Popescu',
      maskedPhone: '+373 ••• ••016',
      ownerName: 'Ioana Radu',
      projectCode: 'ENS1901',
      dealStatus: 'OPEN',
    });
    expect(JSON.stringify(result)).not.toContain(DEAL.name);
  });

  it('should read the contacts behind matched deals even when the term did not match them', async () => {
    const { service, bookReader } = buildService();

    await service.lookup({ ...lookupParams, searchTerm: 'ARTIMA' });

    expect(bookReader.findPeopleByIds).toHaveBeenCalledWith('workspace-id', [
      PERSON.id,
    ]);
  });

  it('should spend no allowance and read nothing once the daily limit is reached', async () => {
    const { service, bookReader } = buildService({
      usedAllowance: ENSO_LEAD_LOOKUP_DAILY_ALLOWANCE,
    });

    const result = await service.lookup({
      ...lookupParams,
      searchTerm: 'ARTIMA',
    });

    expect(result.isRateLimited).toBe(true);
    expect(result.matches).toHaveLength(0);
    expect(result.dealMatches).toHaveLength(0);
    expect(bookReader.runInWorkspaceContext).not.toHaveBeenCalled();
  });

  it('should treat a pasted phone number as a phone search', async () => {
    const { service, bookReader } = buildService({ matchedDeals: [] });

    await service.lookup({ ...lookupParams, searchTerm: '+373 69 461 016' });

    expect(bookReader.findPeopleBySearchTerm).toHaveBeenCalledWith(
      expect.objectContaining({ matchMode: 'PHONE' }),
    );
  });
});
