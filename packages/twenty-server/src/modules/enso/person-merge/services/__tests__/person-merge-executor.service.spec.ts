import { PersonMergeExecutorService } from 'src/modules/enso/person-merge/services/person-merge-executor.service';

// The merge soft-deletes the duplicates only after their relations have been
// re-pointed at the keeper. If a reassignment fails and the delete goes ahead
// anyway, the rows that still point at the duplicate become reachable from no
// live person — which is exactly what happened in production, silently,
// because every reassignment was wrapped in a warn-and-continue.

const KEEPER = {
  id: 'keeper-id',
  createdAt: new Date('2026-01-01'),
  name: { firstName: 'Ada', lastName: 'L' },
  emails: { primaryEmail: 'ada@example.com' },
  phones: { primaryPhoneNumber: '60123456' },
  companyId: 'company-id',
};

const DUPLICATE = {
  ...KEEPER,
  id: 'duplicate-id',
  createdAt: new Date('2026-02-01'),
};

type RepoOverrides = { failOn?: string };

const buildManager = ({ failOn }: RepoOverrides = {}) => {
  const personRepository = {
    find: jest.fn().mockResolvedValue([KEEPER, DUPLICATE]),
    update: jest.fn().mockResolvedValue(undefined),
    softDelete: jest.fn().mockResolvedValue(undefined),
  };

  const otherRepository = {
    update: jest.fn().mockResolvedValue(undefined),
    insert: jest.fn().mockResolvedValue(undefined),
  };

  const globalWorkspaceOrmManager = {
    executeInWorkspaceContext: jest.fn((callback: () => unknown) => callback()),
    getRepository: jest.fn(async (_workspaceId: string, object: string) => {
      if (object === failOn) {
        throw new Error(`no repository for ${object}`);
      }

      return object === 'person' ? personRepository : otherRepository;
    }),
  };

  return { globalWorkspaceOrmManager, personRepository, otherRepository };
};

const AUTH_CONTEXT = { workspace: { id: 'workspace-id' } } as never;

describe('PersonMergeExecutorService', () => {
  it('should soft-delete the duplicate when every reassignment succeeds', async () => {
    const { globalWorkspaceOrmManager, personRepository } = buildManager();

    const service = new PersonMergeExecutorService(
      globalWorkspaceOrmManager as never,
    );

    const result = await service.mergeDuplicates(AUTH_CONTEXT, [
      KEEPER.id,
      DUPLICATE.id,
    ]);

    expect(result).toEqual({
      keeperId: KEEPER.id,
      mergedIds: [DUPLICATE.id],
    });
    expect(personRepository.softDelete).toHaveBeenCalledWith({
      id: DUPLICATE.id,
    });
  });

  it('should abort without deleting anything when a reassignment fails', async () => {
    const { globalWorkspaceOrmManager, personRepository } = buildManager({
      failOn: 'inboundActivity',
    });

    const service = new PersonMergeExecutorService(
      globalWorkspaceOrmManager as never,
    );

    const result = await service.mergeDuplicates(AUTH_CONTEXT, [
      KEEPER.id,
      DUPLICATE.id,
    ]);

    expect(result).toBeNull();
    // The duplicate stays live and visible: a merge that shows up as an
    // un-merged pair is recoverable, a stranded relation is not.
    expect(personRepository.softDelete).not.toHaveBeenCalled();
  });
});
