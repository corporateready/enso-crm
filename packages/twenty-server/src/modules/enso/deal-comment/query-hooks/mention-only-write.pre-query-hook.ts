import { Injectable } from '@nestjs/common';

import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';

import {
  WorkspaceQueryHook,
  type WorkspaceQueryHookKey,
} from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { MentionOnlyAccessService } from 'src/modules/enso/deal-comment/services/mention-only-access.service';

// The single-record writes a manager reaches from a deal or contact page.
const GUARDED_KEYS: {
  key: WorkspaceQueryHookKey;
  objectName: 'opportunity' | 'person';
}[] = [
  { key: 'opportunity.updateOne', objectName: 'opportunity' },
  { key: 'opportunity.deleteOne', objectName: 'opportunity' },
  { key: 'opportunity.destroyOne', objectName: 'opportunity' },
  { key: 'person.updateOne', objectName: 'person' },
  { key: 'person.deleteOne', objectName: 'person' },
  { key: 'person.destroyOne', objectName: 'person' },
];

const buildMentionOnlyWriteHook = ({
  key,
  objectName,
}: (typeof GUARDED_KEYS)[number]) => {
  @Injectable()
  @WorkspaceQueryHook(key)
  class MentionOnlyWriteHook implements WorkspacePreQueryHookInstance {
    // Public: the class is built by a factory and exported, and TypeScript
    // can't emit a private member on an anonymous exported class type.
    constructor(readonly mentionOnlyAccessService: MentionOnlyAccessService) {}

    async execute<TPayload>(
      authContext: WorkspaceAuthContext,
      _objectName: string,
      payload: TPayload,
    ): Promise<TPayload> {
      await this.mentionOnlyAccessService.assertNotMentionOnly({
        authContext,
        objectName,
        recordId: (payload as { id?: string } | undefined)?.id,
      });

      return payload;
    }
  }

  return MentionOnlyWriteHook;
};

export const MENTION_ONLY_WRITE_HOOKS = GUARDED_KEYS.map(
  buildMentionOnlyWriteHook,
);
