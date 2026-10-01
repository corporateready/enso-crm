import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { PersonRelationshipNameService } from 'src/modules/enso/person-relationship/services/person-relationship-name.service';
import {
  type PartnerFields,
  partnerNeedsUpdate,
  planPartnerSync,
  type RelationshipRow,
} from 'src/modules/enso/person-relationship/utils/plan-partner-sync.util';

// Keeps the two halves of a family link in step. A canonical row
// (person=A, relatedPerson=B, type=CHILD) has a mirror from B's side
// (person=B, relatedPerson=A, type=PARENT) whose `mirrorOfId` points back to
// the canonical. Managers see and edit whichever half sits on the record they
// are looking at, so every write — on either half — is propagated to the
// other one: edits sync it, deletes and restores follow it, and a half that
// stops being a complete link takes its partner with it.
//
// All writes here go straight to the repository, which bypasses the query
// hooks, so propagating to the partner never re-enters this service.
//
// IMPORTANT: post-query hooks receive the resolver result, whose fields depend
// on the client's GraphQL selection set — so the flat FK columns
// (personId / relatedPersonId / relationType) may be ABSENT. We therefore only
// trust the `id` from the hook payload and re-fetch the full row here, with a
// system auth context that bypasses permission checks: a Sales Manager may own
// only one of the two people.

type RowRef = { id?: string | null };

type StoredRelationshipRow = RelationshipRow & {
  name?: string | null;
  deletedAt?: Date | string | null;
};

// Raw inserts bypass the create resolver that normally fills the `createdBy`
// ACTOR from auth context, and `createdByName` / `updatedByName` are NOT NULL.
// Mirror rows are system-generated, so stamp them as a SYSTEM actor.
const SYSTEM_ACTOR = {
  source: 'SYSTEM',
  name: 'ENSO CRM',
  context: {},
} as const;

@Injectable()
export class PersonRelationshipMirrorService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly nameService: PersonRelationshipNameService,
  ) {}

  private async withRepository<TResult>(
    workspaceId: string,
    callback: (repository: any) => Promise<TResult>,
  ): Promise<TResult> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository =
          await this.globalWorkspaceOrmManager.getRepository<any>(
            workspaceId,
            'personRelationship',
            { shouldBypassPermissionChecks: true },
          );

        return callback(repository);
      },
      buildSystemAuthContext(workspaceId),
    );
  }

  private async findLivePartner(
    repository: any,
    row: StoredRelationshipRow,
  ): Promise<StoredRelationshipRow | null> {
    return repository.findOne({
      where: isDefined(row.mirrorOfId)
        ? { id: row.mirrorOfId }
        : { mirrorOfId: row.id },
    });
  }

  // After a create or an update on either half: create, update or remove the
  // other half so both people see the same link.
  async syncPairFor(
    authContext: WorkspaceAuthContext,
    ref: RowRef,
  ): Promise<void> {
    const workspaceId = authContext.workspace?.id;

    if (!isDefined(workspaceId) || !isDefined(ref.id)) return;

    const { row, partner } = await this.withRepository(
      workspaceId,
      async (repository) => {
        const row: StoredRelationshipRow | null = await repository.findOne({
          where: { id: ref.id },
        });

        return {
          row,
          partner: isDefined(row)
            ? await this.findLivePartner(repository, row)
            : null,
        };
      },
    );

    if (!isDefined(row)) return;

    const plan = planPartnerSync(row, partner);

    if (plan.kind === 'none') return;

    if (plan.kind === 'remove') {
      await this.withRepository(workspaceId, async (repository) => {
        await repository.softDelete({ id: plan.partnerId });

        if (plan.removeSelf) {
          await repository.softDelete({ id: row.id });
        }
      });

      return;
    }

    // Bulk updates skip the name pre-hook, so rebuild both labels here.
    const [ownName, partnerName] = await Promise.all([
      this.nameService.computeName(authContext, {
        relatedPersonId: row.relatedPersonId,
        relationType: row.relationType,
      }),
      this.nameService.computeName(authContext, plan.fields),
    ]);

    await this.withRepository(workspaceId, async (repository) => {
      if (isDefined(ownName) && row.name !== ownName) {
        await repository.update({ id: row.id }, { name: ownName });
      }

      if (plan.kind === 'create') {
        await this.insertPartner(repository, row.id, plan.fields, partnerName);

        if (plan.promoteSelf) {
          await repository.update({ id: row.id }, { mirrorOfId: null });
        }

        return;
      }

      if (
        isDefined(partner) &&
        (partnerNeedsUpdate(partner, plan.fields) ||
          (isDefined(partnerName) && partner.name !== partnerName))
      ) {
        await repository.update(
          { id: plan.partnerId },
          {
            ...plan.fields,
            ...(isDefined(partnerName) ? { name: partnerName } : {}),
          },
        );
      }
    });
  }

  private async insertPartner(
    repository: any,
    canonicalId: string,
    fields: PartnerFields,
    name: string | undefined,
  ): Promise<void> {
    // Raw insert bypasses the create resolver, which is what normally
    // auto-assigns `position`. Set it explicitly (mirrors create-person.service).
    const lastPosition = await repository.maximum('position', undefined);

    await repository.insert({
      ...fields,
      mirrorOfId: canonicalId,
      position: (lastPosition ?? 0) + 1,
      createdBy: SYSTEM_ACTOR,
      updatedBy: SYSTEM_ACTOR,
      ...(isDefined(name) ? { name } : {}),
    });
  }

  // After either half is soft-deleted: soft-delete the other half.
  async deletePartnerOf(
    authContext: WorkspaceAuthContext,
    ref: RowRef,
  ): Promise<void> {
    const workspaceId = authContext.workspace?.id;

    if (!isDefined(workspaceId) || !isDefined(ref.id)) return;

    await this.withRepository(workspaceId, async (repository) => {
      const row: StoredRelationshipRow | null = await repository.findOne({
        where: { id: ref.id },
        withDeleted: true,
      });

      if (!isDefined(row)) return;

      const partner = await this.findLivePartner(repository, row);

      if (isDefined(partner)) {
        await repository.softDelete({ id: partner.id });
      }
    });
  }

  // After either half is restored from trash: restore the other half too, so
  // the link reappears on both people at once.
  async restorePartnerOf(
    authContext: WorkspaceAuthContext,
    ref: RowRef,
  ): Promise<void> {
    const workspaceId = authContext.workspace?.id;

    if (!isDefined(workspaceId) || !isDefined(ref.id)) return;

    await this.withRepository(workspaceId, async (repository) => {
      const row: StoredRelationshipRow | null = await repository.findOne({
        where: { id: ref.id },
      });

      if (!isDefined(row)) return;

      const candidates: StoredRelationshipRow[] = await repository.find({
        where: isDefined(row.mirrorOfId)
          ? { id: row.mirrorOfId }
          : { mirrorOfId: row.id },
        withDeleted: true,
      });

      if (candidates.some((candidate) => !isDefined(candidate.deletedAt))) {
        return;
      }

      const latestDeleted = candidates.sort(
        (left, right) =>
          new Date(right.deletedAt ?? 0).getTime() -
          new Date(left.deletedAt ?? 0).getTime(),
      )[0];

      if (isDefined(latestDeleted)) {
        await repository.restore({ id: latestDeleted.id });
      }
    });
  }
}
