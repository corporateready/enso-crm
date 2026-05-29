import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { PersonRelationshipNameService } from 'src/modules/enso/person-relationship/services/person-relationship-name.service';

// Mirror-write for personRelationship: when a canonical row is created
// (person=A, relatedPerson=B, type=CHILD), a mirror row is auto-created from
// B's perspective (person=B, relatedPerson=A, type=PARENT). The mirror row's
// `mirrorOfId` points back to the canonical — that's the loop-guard: any hook
// short-circuits when `mirrorOfId IS NOT NULL`, so mirror writes never cascade
// further. Updates on canonical sync the mirror; deletes cascade.
//
// IMPORTANT: post-query hooks receive the resolver result, whose fields depend
// on the client's GraphQL selection set — so the flat FK columns
// (personId / relatedPersonId / relationType) may be ABSENT. We therefore only
// trust the `id` from the hook payload and re-fetch the full row from the
// repository here. All reads/writes use a system auth context with
// `shouldBypassPermissionChecks` (same pattern as PersonRelationshipNameService).

type RowRef = { id?: string | null };

type RelationshipRow = {
  id: string;
  personId?: string | null;
  relatedPersonId?: string | null;
  relationType?: string | null;
  mirrorOfId?: string | null;
};

// Symmetric types map to themselves; asymmetric (CHILD/PARENT) invert.
const INVERSE_RELATION_TYPE: Record<string, string> = {
  SPOUSE: 'SPOUSE',
  PARTNER: 'PARTNER',
  SIBLING: 'SIBLING',
  OTHER: 'OTHER',
  CHILD: 'PARENT',
  PARENT: 'CHILD',
};

@Injectable()
export class PersonRelationshipMirrorService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly nameService: PersonRelationshipNameService,
  ) {}

  private inverseType(type: string | null | undefined): string | undefined {
    if (!type) return undefined;

    return INVERSE_RELATION_TYPE[type] ?? type;
  }

  private async loadRow(
    workspaceId: string,
    id: string,
    withDeleted = false,
  ): Promise<RelationshipRow | null> {
    const systemAuthContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository =
          await this.globalWorkspaceOrmManager.getRepository<any>(
            workspaceId,
            'personRelationship',
            { shouldBypassPermissionChecks: true },
          );

        return repository.findOne({ where: { id }, withDeleted });
      },
      systemAuthContext,
    );
  }

  // Create the mirror counterpart of a canonical row. Idempotent.
  async createMirrorFor(
    authContext: WorkspaceAuthContext,
    ref: RowRef,
  ): Promise<void> {
    const workspaceId = authContext.workspace?.id;

    if (!workspaceId || !isDefined(ref.id)) return;

    const canonical = await this.loadRow(workspaceId, ref.id);

    if (!canonical || isDefined(canonical.mirrorOfId)) return; // not canonical
    if (
      !isDefined(canonical.personId) ||
      !isDefined(canonical.relatedPersonId) ||
      !isDefined(canonical.relationType)
    ) {
      return;
    }

    // Mirror is from the other person's perspective: people swapped, type inverted.
    const mirrorPersonId = canonical.relatedPersonId;
    const mirrorRelatedPersonId = canonical.personId;
    const mirrorType = this.inverseType(canonical.relationType);

    // Compute the mirror's composite name (the raw insert below bypasses the
    // pre-query name hook, so we set it explicitly).
    const name = await this.nameService.computeName(authContext, {
      relatedPersonId: mirrorRelatedPersonId,
      relationType: mirrorType,
    });

    const systemAuthContext = buildSystemAuthContext(workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const repository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'personRelationship',
          { shouldBypassPermissionChecks: true },
        );

      const existing = await repository.findOne({
        where: { mirrorOfId: canonical.id },
      });

      if (existing) return;

      // Raw insert bypasses the create resolver, which is what normally
      // auto-assigns `position`. Set it explicitly (mirrors create-person.service).
      const lastPosition = await repository.maximum('position', undefined);

      await repository.insert({
        personId: mirrorPersonId,
        relatedPersonId: mirrorRelatedPersonId,
        relationType: mirrorType,
        mirrorOfId: canonical.id,
        position: (lastPosition ?? 0) + 1,
        ...(isDefined(name) ? { name } : {}),
      });
    }, systemAuthContext);
  }

  // Sync the mirror's fields when the canonical's people or type change.
  async syncMirrorFor(
    authContext: WorkspaceAuthContext,
    ref: RowRef,
  ): Promise<void> {
    const workspaceId = authContext.workspace?.id;

    if (!workspaceId || !isDefined(ref.id)) return;

    const canonical = await this.loadRow(workspaceId, ref.id);

    if (!canonical || isDefined(canonical.mirrorOfId)) return; // not canonical
    if (
      !isDefined(canonical.personId) ||
      !isDefined(canonical.relatedPersonId) ||
      !isDefined(canonical.relationType)
    ) {
      return;
    }

    const mirrorPersonId = canonical.relatedPersonId;
    const mirrorRelatedPersonId = canonical.personId;
    const mirrorType = this.inverseType(canonical.relationType);

    const name = await this.nameService.computeName(authContext, {
      relatedPersonId: mirrorRelatedPersonId,
      relationType: mirrorType,
    });

    const systemAuthContext = buildSystemAuthContext(workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const repository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'personRelationship',
          { shouldBypassPermissionChecks: true },
        );

      const mirror = await repository.findOne({
        where: { mirrorOfId: canonical.id },
      });

      if (!mirror) {
        // Canonical has no mirror yet (e.g. pre-dates this feature) — create it.
        const lastPosition = await repository.maximum('position', undefined);

        await repository.insert({
          personId: mirrorPersonId,
          relatedPersonId: mirrorRelatedPersonId,
          relationType: mirrorType,
          mirrorOfId: canonical.id,
          position: (lastPosition ?? 0) + 1,
          ...(isDefined(name) ? { name } : {}),
        });

        return;
      }

      await repository.update(
        { id: mirror.id },
        {
          personId: mirrorPersonId,
          relatedPersonId: mirrorRelatedPersonId,
          relationType: mirrorType,
          ...(isDefined(name) ? { name } : {}),
        },
      );
    }, systemAuthContext);
  }

  // Soft-delete the mirror after the canonical is soft-deleted.
  async deleteMirrorFor(
    authContext: WorkspaceAuthContext,
    ref: RowRef,
  ): Promise<void> {
    const workspaceId = authContext.workspace?.id;

    if (!workspaceId || !isDefined(ref.id)) return;

    // Load with deleted rows included — the canonical was just soft-deleted.
    const canonical = await this.loadRow(workspaceId, ref.id, true);

    if (!canonical || isDefined(canonical.mirrorOfId)) return; // not canonical

    const systemAuthContext = buildSystemAuthContext(workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const repository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'personRelationship',
          { shouldBypassPermissionChecks: true },
        );

      const mirror = await repository.findOne({
        where: { mirrorOfId: canonical.id },
      });

      if (!mirror) return;

      await repository.softDelete({ id: mirror.id });
    }, systemAuthContext);
  }
}
