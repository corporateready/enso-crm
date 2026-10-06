import { Injectable } from '@nestjs/common';

import { msg } from '@lingui/core/macro';
import { isDefined } from 'twenty-shared/utils';

import {
  CommonQueryRunnerException,
  CommonQueryRunnerExceptionCode,
} from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import {
  DEAL_STAGE_LABELS,
  DEAL_STAGE_REQUIREMENTS,
} from 'src/modules/enso/deal-stage-gate/deal-stage-gate.constants';
import {
  type DealStageViolation,
  findDealStageViolation,
} from 'src/modules/enso/deal-stage-gate/utils/find-deal-stage-violation.util';

const GATED_FIELD_NAMES = new Set([
  'stage',
  ...Object.values(DEAL_STAGE_REQUIREMENTS).flatMap((requirements) =>
    requirements.map((requirement) => requirement.fieldName),
  ),
]);

const stageLabel = (stage: string): string => DEAL_STAGE_LABELS[stage] ?? stage;

// Enforces the stage gate on writes that come through the record API — the
// board, the record page, imports and API keys. The pipeline's own writes
// (intake, routing, the sequencing scanner) go through the ORM directly and
// set the required fields themselves.
@Injectable()
export class DealStageGateService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  touchesGate(data: Record<string, unknown>): boolean {
    return Object.keys(data).some((fieldName) =>
      GATED_FIELD_NAMES.has(fieldName),
    );
  }

  async assertCanUpdate(
    authContext: WorkspaceAuthContext,
    ids: string[],
    data: Record<string, unknown>,
  ): Promise<void> {
    const workspaceId = authContext.workspace?.id;

    if (
      !isDefined(workspaceId) ||
      ids.length === 0 ||
      !this.touchesGate(data)
    ) {
      return;
    }

    const deals: Record<string, unknown>[] =
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const repository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'opportunity',
              { shouldBypassPermissionChecks: true },
            );

          return repository.find({ where: ids.map((id) => ({ id })) });
        },
        buildSystemAuthContext(workspaceId),
      );

    for (const deal of deals) {
      const violation = findDealStageViolation(deal, data);

      if (isDefined(violation)) {
        throw this.toException(violation);
      }
    }
  }

  // Bulk edits are only judged when they name their deals by id; anything
  // broader cannot be checked deal by deal, so it may not touch the gate.
  extractIdsFromFilter(filter: unknown): string[] | null {
    const idFilter = (filter as { id?: { eq?: unknown; in?: unknown } })?.id;

    if (typeof idFilter?.eq === 'string') {
      return [idFilter.eq];
    }

    if (
      Array.isArray(idFilter?.in) &&
      idFilter.in.every((id) => typeof id === 'string')
    ) {
      return idFilter.in as string[];
    }

    return null;
  }

  buildUnscopedBulkUpdateException(): CommonQueryRunnerException {
    return new CommonQueryRunnerException(
      'Stage and stage-required fields can only be bulk-updated by deal id',
      CommonQueryRunnerExceptionCode.INVALID_ARGS_DATA,
      {
        userFriendlyMessage: msg`Change the stage of these deals one by one.`,
      },
    );
  }

  private toException(
    violation: DealStageViolation,
  ): CommonQueryRunnerException {
    if (violation.type === 'SKIPPED_STAGE') {
      const nextStage = stageLabel(violation.nextStage);
      const toStage = stageLabel(violation.toStage);

      return new CommonQueryRunnerException(
        `Deal cannot skip from ${violation.fromStage} to ${violation.toStage}`,
        CommonQueryRunnerExceptionCode.INVALID_ARGS_DATA,
        {
          userFriendlyMessage: msg`Deals move one stage at a time. Move this deal to ${nextStage} before ${toStage}.`,
        },
      );
    }

    const stage = stageLabel(violation.stage);
    const fields = violation.missing
      .map((requirement) => requirement.label)
      .join(', ');

    return new CommonQueryRunnerException(
      `Deal in ${violation.stage} is missing ${violation.missing
        .map((requirement) => requirement.fieldName)
        .join(', ')}`,
      CommonQueryRunnerExceptionCode.INVALID_ARGS_DATA,
      {
        userFriendlyMessage: violation.isStageChange
          ? msg`Fill in ${fields} before moving this deal to ${stage}.`
          : msg`A deal in ${stage} needs ${fields}, so it can't be cleared.`,
      },
    );
  }
}
