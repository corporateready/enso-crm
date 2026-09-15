import { QueryFailedError } from 'typeorm';

import { PersonMergeExecutorService } from 'src/modules/enso/person-merge/services/person-merge-executor.service';

// The merge soft-deletes the duplicates only after their relations have been
// re-pointed at the keeper. Two failures have to be told apart:
//
//   - a unique-constraint clash means the keeper already holds an equivalent
//     row, so nothing is lost and the merge must finish — retrying would clash
//     forever, so aborting would strand the duplicates permanently;
//   - anything else leaves us unable to say what the delete would strand, so
//     the merge must be abandoned with every record untouched.

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

const buildUniqueViolation = () => {
  const error = new QueryFailedError('update', [], new Error('duplicate key'));

  (error as QueryFailedError & { code?: string }).code = '23505';

  return error;
};

type Options = {
  unreachableObject?: string;
  clashingObject?: string;
};

const buildManager = ({ unreachableObject, clashingObject }: Options = {}) => {
  const personRepository = {
    find: jest.fn().mockResolvedValue([KEEPER, DUPLICATE]),
    update: jest.fn().mockResolvedValue(undefined),
    softDelete: jest.fn().mockResolvedValue(undefined),
  };

  const clashingRepository = {
    find: jest.fn().mockResolvedValue([{ id: 'clashing-row' }]),
    update: jest.fn().mockRejectedValue(buildUniqueViolation()),
    insert: jest.fn().mockResolvedValue(undefined),
  };

  const otherRepository = {
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(undefined),
    insert: jest.fn().mockResolvedValue(undefined),
  };

  const globalWorkspaceOrmManager = {
    executeInWorkspaceContext: jest.fn((callback: () => unknown) => callback()),
    getRepository: jest.fn(async (_workspaceId: string, object: string) => {
      if (object === unreachableObject) {
        throw new Error(`no repository for ${object}`);
      }

      if (object === 'person') return personRepository;
      if (object === clashingObject) return clashingRepository;

      return otherRepository;
    }),
  };

  return { globalWorkspaceOrmManager, personRepository, clashingRepository };
};

const AUTH_CONTEXT = { workspace: { id: 'workspace-id' } } as never;

const merge = (globalWorkspaceOrmManager: unknown) =>
  new PersonMergeExecutorService(
    globalWorkspaceOrmManager as never,
  ).mergeDuplicates(AUTH_CONTEXT, [KEEPER.id, DUPLICATE.id]);

describe('PersonMergeExecutorService', () => {
  it('should soft-delete the duplicate when every reassignment succeeds', async () => {
    const { globalWorkspaceOrmManager, personRepository } = buildManager();

    const result = await merge(globalWorkspaceOrmManager);

    expect(result).toEqual({
      keeperId: KEEPER.id,
      mergedIds: [DUPLICATE.id],
    });
    expect(personRepository.softDelete).toHaveBeenCalledWith({
      id: DUPLICATE.id,
    });
  });

  it('should abort without deleting anything when an object cannot be reached', async () => {
    const { globalWorkspaceOrmManager, personRepository } = buildManager({
      unreachableObject: 'inboundActivity',
    });

    const result = await merge(globalWorkspaceOrmManager);

    expect(result).toBeNull();
    // The duplicate stays live and visible: a merge that shows up as an
    // un-merged pair is recoverable, a stranded relation is not.
    expect(personRepository.softDelete).not.toHaveBeenCalled();
  });

  it('should finish the merge when a reassignment only hits a unique-constraint clash', async () => {
    const { globalWorkspaceOrmManager, personRepository, clashingRepository } =
      buildManager({ clashingObject: 'opportunity' });

    const result = await merge(globalWorkspaceOrmManager);

    expect(result).toEqual({
      keeperId: KEEPER.id,
      mergedIds: [DUPLICATE.id],
    });
    // Retried row by row, because the bulk statement also blocks rows that
    // would have moved cleanly.
    expect(clashingRepository.find).toHaveBeenCalled();
    expect(clashingRepository.update).toHaveBeenCalledWith(
      { id: 'clashing-row' },
      expect.objectContaining({ pointOfContactId: KEEPER.id }),
    );
    // The clash is survivable, so the merge still completes.
    expect(personRepository.softDelete).toHaveBeenCalledWith({
      id: DUPLICATE.id,
    });
  });
});
