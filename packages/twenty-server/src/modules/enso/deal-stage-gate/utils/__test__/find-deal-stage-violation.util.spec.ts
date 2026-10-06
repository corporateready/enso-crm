import {
  findDealStageViolation,
  getCumulativeDealStageRequirements,
} from 'src/modules/enso/deal-stage-gate/utils/find-deal-stage-violation.util';

const connectedFields = {
  firstContactAt: '2026-10-06T10:00:00.000Z',
  firstContactChannel: 'CALL',
};

describe('findDealStageViolation', () => {
  it('should allow moving to the next stage when its fields are filled', () => {
    expect(
      findDealStageViolation(
        { stage: 'LEAD_CLAIMED', ownerId: 'member-1' },
        { stage: 'CONNECTED', ...connectedFields },
      ),
    ).toBeNull();
  });

  it('should accept fields already stored on the deal', () => {
    expect(
      findDealStageViolation(
        { stage: 'LEAD_CLAIMED', ...connectedFields },
        { stage: 'CONNECTED' },
      ),
    ).toBeNull();
  });

  it('should reject skipping a stage and name the next one', () => {
    expect(
      findDealStageViolation(
        { stage: 'LEAD_CLAIMED', ...connectedFields },
        { stage: 'DEEP_QUALIFICATION' },
      ),
    ).toEqual({
      type: 'SKIPPED_STAGE',
      fromStage: 'LEAD_CLAIMED',
      toStage: 'DEEP_QUALIFICATION',
      nextStage: 'CONNECTED',
    });
  });

  it('should list the missing fields when moving into a gated stage', () => {
    expect(
      findDealStageViolation(
        { stage: 'LEAD_CLAIMED', firstContactChannel: 'CALL' },
        { stage: 'CONNECTED' },
      ),
    ).toEqual({
      type: 'MISSING_FIELDS',
      stage: 'CONNECTED',
      isStageChange: true,
      missing: [{ fieldName: 'firstContactAt', label: 'First contact date' }],
    });
  });

  it('should treat an empty string as missing', () => {
    expect(
      findDealStageViolation(
        { stage: 'ROUTING' },
        { stage: 'LEAD_CLAIMED', ownerId: '' },
      )?.type,
    ).toBe('MISSING_FIELDS');
  });

  it('should require a lost reason to close a deal as lost from any stage', () => {
    expect(
      findDealStageViolation({ stage: 'ROUTING' }, { stage: 'CLOSED_LOST' })
        ?.type,
    ).toBe('MISSING_FIELDS');
    expect(
      findDealStageViolation(
        { stage: 'ROUTING' },
        { stage: 'CLOSED_LOST', lostReason: 'NOT_INTERESTED' },
      ),
    ).toBeNull();
  });

  it('should allow closing as won from any open stage', () => {
    expect(
      findDealStageViolation({ stage: 'CONNECTED' }, { stage: 'CLOSED_WON' }),
    ).toBeNull();
  });

  it('should allow moving back without a skip check', () => {
    expect(
      findDealStageViolation(
        { stage: 'DEMO', ownerId: 'member-1' },
        { stage: 'LEAD_CLAIMED' },
      ),
    ).toBeNull();
  });

  it('should let a closed deal reopen without a skip check', () => {
    expect(
      findDealStageViolation(
        { stage: 'CLOSED_LOST', lostReason: 'TIMING' },
        { stage: 'DEMO' },
      ),
    ).toBeNull();
  });

  it('should leave deals that predate the gate editable', () => {
    expect(
      findDealStageViolation({ stage: 'CONNECTED' }, { amount: 1000 }),
    ).toBeNull();
    expect(
      findDealStageViolation(
        { stage: 'CONNECTED' },
        { firstContactChannel: 'CALL' },
      ),
    ).toBeNull();
  });

  it('should reject clearing a field the current stage requires', () => {
    expect(
      findDealStageViolation(
        { stage: 'CONNECTED', ...connectedFields },
        { firstContactAt: null },
      ),
    ).toEqual({
      type: 'MISSING_FIELDS',
      stage: 'CONNECTED',
      isStageChange: false,
      missing: [{ fieldName: 'firstContactAt', label: 'First contact date' }],
    });
  });

  it('should ignore updates that leave the stage and its fields alone', () => {
    expect(findDealStageViolation({}, { amount: 1000 })).toBeNull();
  });
});

describe('getCumulativeDealStageRequirements', () => {
  it('should collect every stage up to the starting one', () => {
    expect(
      getCumulativeDealStageRequirements('CONNECTED').map(
        (requirement) => requirement.fieldName,
      ),
    ).toEqual(['ownerId', 'firstContactAt', 'firstContactChannel']);
  });

  it('should need nothing to start in routing', () => {
    expect(getCumulativeDealStageRequirements('ROUTING')).toEqual([]);
  });

  it('should only need its own fields for a closed stage', () => {
    expect(
      getCumulativeDealStageRequirements('CLOSED_LOST').map(
        (requirement) => requirement.fieldName,
      ),
    ).toEqual(['lostReason']);
  });
});
