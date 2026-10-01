import {
  findLinkValidationError,
  planPartnerSync,
} from 'src/modules/enso/person-relationship/utils/plan-partner-sync.util';

const IVAN = 'ivan';
const MARIA = 'maria';
const ANA = 'ana';

describe('planPartnerSync', () => {
  it('should create the mirror when a canonical link becomes complete', () => {
    expect(
      planPartnerSync(
        {
          id: 'canonical',
          personId: IVAN,
          relatedPersonId: MARIA,
          relationType: 'CHILD',
          mirrorOfId: null,
        },
        null,
      ),
    ).toEqual({
      kind: 'create',
      fields: {
        personId: MARIA,
        relatedPersonId: IVAN,
        relationType: 'PARENT',
      },
      promoteSelf: false,
    });
  });

  it('should leave a half-filled draft alone', () => {
    expect(
      planPartnerSync(
        { id: 'draft', personId: IVAN, relatedPersonId: null },
        null,
      ),
    ).toEqual({ kind: 'none' });
  });

  it('should update the canonical when the mirror is edited', () => {
    expect(
      planPartnerSync(
        {
          id: 'mirror',
          personId: MARIA,
          relatedPersonId: IVAN,
          relationType: 'SPOUSE',
          mirrorOfId: 'canonical',
        },
        {
          id: 'canonical',
          personId: IVAN,
          relatedPersonId: MARIA,
          relationType: 'PARTNER',
        },
      ),
    ).toEqual({
      kind: 'update',
      partnerId: 'canonical',
      fields: {
        personId: IVAN,
        relatedPersonId: MARIA,
        relationType: 'SPOUSE',
      },
    });
  });

  it('should remove both halves when the subject person is detached', () => {
    expect(
      planPartnerSync(
        {
          id: 'mirror',
          personId: null,
          relatedPersonId: IVAN,
          relationType: 'SPOUSE',
          mirrorOfId: 'canonical',
        },
        { id: 'canonical', personId: IVAN, relatedPersonId: MARIA },
      ),
    ).toEqual({ kind: 'remove', partnerId: 'canonical', removeSelf: true });
  });

  it('should remove only the other half when the relation type is cleared', () => {
    expect(
      planPartnerSync(
        {
          id: 'canonical',
          personId: IVAN,
          relatedPersonId: MARIA,
          relationType: null,
        },
        { id: 'mirror', personId: MARIA, relatedPersonId: IVAN },
      ),
    ).toEqual({ kind: 'remove', partnerId: 'mirror', removeSelf: false });
  });

  it('should promote a mirror whose canonical is gone', () => {
    expect(
      planPartnerSync(
        {
          id: 'mirror',
          personId: MARIA,
          relatedPersonId: IVAN,
          relationType: 'SIBLING',
          mirrorOfId: 'deleted-canonical',
        },
        null,
      ),
    ).toMatchObject({ kind: 'create', promoteSelf: true });
  });
});

describe('findLinkValidationError', () => {
  it('should reject linking a person to themselves', () => {
    expect(
      findLinkValidationError({ personId: IVAN, relatedPersonId: IVAN }, []),
    ).toBe('SELF_LINK');
  });

  it('should reject a link the pair already has from the other side', () => {
    expect(
      findLinkValidationError({ personId: MARIA, relatedPersonId: IVAN }, [
        { id: 'canonical', personId: IVAN, relatedPersonId: MARIA },
        {
          id: 'mirror',
          personId: MARIA,
          relatedPersonId: IVAN,
          mirrorOfId: 'canonical',
        },
      ]),
    ).toBe('DUPLICATE_LINK');
  });

  it('should not treat a row and its own mirror as duplicates', () => {
    expect(
      findLinkValidationError(
        { id: 'canonical', personId: IVAN, relatedPersonId: MARIA },
        [
          { id: 'canonical', personId: IVAN, relatedPersonId: MARIA },
          {
            id: 'mirror',
            personId: MARIA,
            relatedPersonId: IVAN,
            mirrorOfId: 'canonical',
          },
        ],
      ),
    ).toBeUndefined();
  });

  it('should allow a link to a different person', () => {
    expect(
      findLinkValidationError({ personId: IVAN, relatedPersonId: ANA }, [
        { id: 'canonical', personId: IVAN, relatedPersonId: MARIA },
      ]),
    ).toBeUndefined();
  });

  it('should skip validation until both people are chosen', () => {
    expect(
      findLinkValidationError({ personId: IVAN, relatedPersonId: null }, []),
    ).toBeUndefined();
  });
});
