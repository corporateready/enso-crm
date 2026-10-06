import { Injectable } from '@nestjs/common';

import { msg } from '@lingui/core/macro';

import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';

import {
  CommonQueryRunnerException,
  CommonQueryRunnerExceptionCode,
} from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { EnsoViewerScopeService } from 'src/modules/enso/record-visibility/services/enso-viewer-scope.service';

// A deal made with "+ New" skips everything a lead needs — source, attribution,
// owner, first-contact task — and a Sales Manager only sees deals they own, so
// the one they just made can vanish for them. Their way in is "New lead",
// which writes through the ORM and never reaches these hooks. Admins, API keys
// and the pipeline are untouched.
@Injectable()
export class OpportunityCreateGuardService {
  constructor(
    private readonly ensoViewerScopeService: EnsoViewerScopeService,
  ) {}

  async assertMayCreate(authContext: WorkspaceAuthContext): Promise<void> {
    if (authContext.type !== 'user') {
      return;
    }

    const isViewerScoped = await this.ensoViewerScopeService.isViewerScoped({
      workspaceId: authContext.workspace.id,
      userWorkspaceId: authContext.userWorkspaceId,
    });

    if (!isViewerScoped) {
      return;
    }

    throw new CommonQueryRunnerException(
      'Creating deals directly is not available to scoped roles; use ensoCreateManualLead',
      CommonQueryRunnerExceptionCode.BAD_REQUEST,
      {
        userFriendlyMessage: msg`Add new leads with “New lead” in the sidebar, so they get a source, an owner and a first-contact task.`,
      },
    );
  }
}

@Injectable()
@WorkspaceQueryHook(`opportunity.createOne`)
export class OpportunityCreateOneGuardPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly guard: OpportunityCreateGuardService) {}

  async execute<TPayload>(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: TPayload,
  ): Promise<TPayload> {
    await this.guard.assertMayCreate(authContext);

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook(`opportunity.createMany`)
export class OpportunityCreateManyGuardPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly guard: OpportunityCreateGuardService) {}

  async execute<TPayload>(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: TPayload,
  ): Promise<TPayload> {
    await this.guard.assertMayCreate(authContext);

    return payload;
  }
}
