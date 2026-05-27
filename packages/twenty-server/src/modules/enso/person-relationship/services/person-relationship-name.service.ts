import { Injectable } from '@nestjs/common';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

// A personRelationship is a junction record (person × relatedPerson × type).
// Like personProjectAssignment, it has no natural display label, so Twenty
// falls back to "Untitled". This service materializes the meaningful inputs
// (relationType + relatedPerson) into the scalar `name` field, e.g.
// "Spouse · Maria Popescu". Twenty has no native composite-from-relations
// field type, so we compute it here on write.
type RelationshipInput = {
  id?: string;
  relatedPersonId?: string | null;
  relationType?: string | null;
  name?: string | null;
};

const RELATION_TYPE_LABELS: Record<string, string> = {
  SPOUSE: 'Spouse',
  PARTNER: 'Partner',
  CHILD: 'Child',
  PARENT: 'Parent',
  SIBLING: 'Sibling',
  OTHER: 'Related',
};

@Injectable()
export class PersonRelationshipNameService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async computeName(
    authContext: WorkspaceAuthContext,
    record: RelationshipInput,
  ): Promise<string | undefined> {
    const workspace = authContext.workspace;

    if (!workspace) {
      return undefined;
    }

    const workspaceId = workspace.id;

    // The inputs that feed the label (relatedPerson, relationType) may require
    // reading Person, which the caller (API key / restricted Sales Manager) may
    // not have read access to. Compute the label with a system context that
    // bypasses permission checks so the write never fails on the label step.
    const systemAuthContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        let relatedPersonId = record.relatedPersonId ?? undefined;
        let relationType = record.relationType ?? undefined;

        // On update the payload may omit fields that didn't change. Backfill
        // from the existing row so we can always rebuild the full label.
        if ((!relatedPersonId || !relationType) && record.id) {
          const relationshipRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'personRelationship',
              { shouldBypassPermissionChecks: true },
            );

          const existing = await relationshipRepository.findOne({
            where: { id: record.id },
          });

          relatedPersonId =
            relatedPersonId ?? existing?.relatedPersonId ?? undefined;
          relationType = relationType ?? existing?.relationType ?? undefined;
        }

        let relatedPersonName = '';

        if (relatedPersonId) {
          const personRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'person',
              { shouldBypassPermissionChecks: true },
            );

          const relatedPerson = await personRepository.findOne({
            where: { id: relatedPersonId },
          });

          const firstName = relatedPerson?.name?.firstName ?? '';
          const lastName = relatedPerson?.name?.lastName ?? '';

          relatedPersonName = `${firstName} ${lastName}`.trim();
        }

        const typeLabel = relationType
          ? (RELATION_TYPE_LABELS[relationType] ?? relationType)
          : '';

        const parts = [typeLabel, relatedPersonName].filter(Boolean);

        return parts.length > 0 ? parts.join(' · ') : undefined;
      },
      systemAuthContext,
    );
  }
}
