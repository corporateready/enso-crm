import { isDefined } from 'twenty-shared/utils';

import {
  DEAL_STAGE_REQUIREMENTS,
  type DealStageRequirement,
  OPEN_DEAL_STAGES,
} from 'src/modules/enso/deal-stage-gate/deal-stage-gate.constants';

export type DealStageViolation =
  | {
      type: 'SKIPPED_STAGE';
      fromStage: string;
      toStage: string;
      nextStage: string;
    }
  | {
      type: 'MISSING_FIELDS';
      stage: string;
      isStageChange: boolean;
      missing: DealStageRequirement[];
    };

type DealRecord = Record<string, unknown>;

const hasValue = (value: unknown): boolean => isDefined(value) && value !== '';

const openStageIndex = (stage: string): number =>
  (OPEN_DEAL_STAGES as readonly string[]).indexOf(stage);

export const getDealStageRequirements = (
  stage: string,
): readonly DealStageRequirement[] => DEAL_STAGE_REQUIREMENTS[stage] ?? [];

// Everything a deal needs to start in `stage` without passing through the
// stages before it — what the manual lead form asks for. A closed stage only
// needs its own fields.
export const getCumulativeDealStageRequirements = (
  stage: string,
): DealStageRequirement[] => {
  const targetIndex = openStageIndex(stage);

  if (targetIndex === -1) {
    return [...getDealStageRequirements(stage)];
  }

  return OPEN_DEAL_STAGES.slice(0, targetIndex + 1).flatMap((openStage) =>
    getDealStageRequirements(openStage),
  );
};

// Judges one update against the gate. `before` is the stored deal, `changes`
// the fields this update writes.
export const findDealStageViolation = (
  before: DealRecord,
  changes: DealRecord,
): DealStageViolation | null => {
  const fromStage = before.stage as string | undefined;
  const toStage = ('stage' in changes ? changes.stage : fromStage) as
    | string
    | undefined;

  if (!isDefined(toStage)) {
    return null;
  }

  const isStageChange = toStage !== fromStage;

  if (isStageChange && isDefined(fromStage)) {
    const fromIndex = openStageIndex(fromStage);
    const toIndex = openStageIndex(toStage);

    // Only forward moves between open stages can skip. Reopening a closed deal
    // or leaving a retired stage value has no step to skip.
    if (fromIndex !== -1 && toIndex > fromIndex + 1) {
      return {
        type: 'SKIPPED_STAGE',
        fromStage,
        toStage,
        nextStage: OPEN_DEAL_STAGES[fromIndex + 1],
      };
    }
  }

  const after = { ...before, ...changes };

  const missing = getDealStageRequirements(toStage).filter((requirement) => {
    if (hasValue(after[requirement.fieldName])) {
      return false;
    }

    // Without a stage change only a field this update empties counts. Deals
    // that reached a stage before the gate existed may lack its fields, and
    // editing something else on them must keep working.
    return isStageChange || requirement.fieldName in changes;
  });

  if (missing.length === 0) {
    return null;
  }

  return { type: 'MISSING_FIELDS', stage: toStage, isStageChange, missing };
};
