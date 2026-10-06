import {
  type DuplicateCandidate,
  resolveDuplicateVerdict,
} from 'src/modules/enso/manual-lead/utils/resolve-duplicate-verdict.util';

const ME = 'member-me';

const candidate = (
  overrides: Partial<DuplicateCandidate> & { personId: string },
): DuplicateCandidate => ({
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  projectOwnerId: null,
  hasOpenDealOnProject: false,
  ...overrides,
});

describe('resolveDuplicateVerdict', () => {
  it('should create a new contact when nothing matches', () => {
    expect(resolveDuplicateVerdict([], ME)).toEqual({ verdict: 'NEW' });
  });

  it('should block a contact a colleague works on this project', () => {
    expect(
      resolveDuplicateVerdict(
        [candidate({ personId: 'p1', projectOwnerId: 'member-other' })],
        ME,
      ),
    ).toEqual({
      verdict: 'BLOCKED',
      personId: 'p1',
      ownerMemberId: 'member-other',
    });
  });

  it('should block even when another match is the viewer’s own', () => {
    expect(
      resolveDuplicateVerdict(
        [
          candidate({ personId: 'mine', projectOwnerId: ME }),
          candidate({ personId: 'theirs', projectOwnerId: 'member-other' }),
        ],
        ME,
      ).verdict,
    ).toBe('BLOCKED');
  });

  it('should reuse the viewer’s own contact and report its open deal', () => {
    expect(
      resolveDuplicateVerdict(
        [
          candidate({ personId: 'unowned' }),
          candidate({
            personId: 'mine',
            projectOwnerId: ME,
            hasOpenDealOnProject: true,
            createdAt: new Date('2026-05-01T00:00:00.000Z'),
          }),
        ],
        ME,
      ),
    ).toEqual({
      verdict: 'REUSE',
      personId: 'mine',
      hasOpenDealOnProject: true,
    });
  });

  it('should reuse the oldest unowned contact', () => {
    expect(
      resolveDuplicateVerdict(
        [
          candidate({
            personId: 'newer',
            createdAt: new Date('2026-06-01T00:00:00.000Z'),
          }),
          candidate({
            personId: 'older',
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
          }),
        ],
        ME,
      ),
    ).toEqual({
      verdict: 'REUSE',
      personId: 'older',
      hasOpenDealOnProject: false,
    });
  });
});
