import { Injectable, Logger } from '@nestjs/common';

import { In, IsNull } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { SYSTEM_ACTOR } from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';
import { PERSON_RELATION_REASSIGNMENTS } from 'src/modules/enso/person-merge/person-merge.constants';

// Composite fields come back nested from the workspace ORM.
type PersonRow = {
  id: string;
  createdAt: Date;
  name?: { firstName?: string | null; lastName?: string | null } | null;
  emails?: { primaryEmail?: string | null } | null;
  phones?: {
    primaryPhoneNumber?: string | null;
    primaryPhoneCountryCode?: string | null;
    primaryPhoneCallingCode?: string | null;
  } | null;
  companyId?: string | null;
};

// Merges a set of duplicate people into the OLDEST record (the keeper):
//   reassign every person-FK relation off the duplicates → keeper,
//   backfill the keeper's empty contact/name/company fields from a duplicate,
//   soft-delete the duplicates.
// Idempotent: re-running with an already-merged set is a no-op (the duplicates
// are gone). Relation reassignments are best-effort so a unique-constraint clash
// on one junction can't strand the whole merge.
@Injectable()
export class PersonMergeExecutorService {
  private readonly logger = new Logger(PersonMergeExecutorService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async mergeDuplicates(
    authContext: WorkspaceAuthContext,
    personIds: string[],
  ): Promise<{ keeperId: string; mergedIds: string[] } | null> {
    const workspaceId = authContext.workspace?.id;

    if (!workspaceId || personIds.length < 2) {
      return null;
    }

    const systemAuthContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const personRepository =
        await this.globalWorkspaceOrmManager.getRepository<any>(
          workspaceId,
          'person',
          { shouldBypassPermissionChecks: true },
        );

      const persons: PersonRow[] = await personRepository.find({
        where: { id: In(personIds), deletedAt: IsNull() },
        order: { createdAt: 'ASC' },
      });

      // Need at least two live records to merge.
      if (persons.length < 2) {
        return null;
      }

      const keeper = persons[0]; // oldest
      const duplicates = persons.slice(1);
      const duplicateIds = duplicates.map((d) => d.id);

      // 1) Re-point every person-FK relation from the duplicates to the keeper.
      // These FKs (personId / pointOfContactId / relatedPersonId) are flat
      // columns on the related objects, not composites.
      for (const { object, field } of PERSON_RELATION_REASSIGNMENTS) {
        try {
          const repository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              object,
              { shouldBypassPermissionChecks: true },
            );

          await repository.update(
            { [field]: In(duplicateIds) },
            { [field]: keeper.id, updatedBy: SYSTEM_ACTOR },
          );
        } catch (error) {
          this.logger.warn(
            `Reassign ${object}.${field} → keeper ${keeper.id} failed: ${
              (error as Error).message
            }`,
          );
        }
      }

      // 2) Backfill the keeper's empty contact/name/company from a duplicate.
      // Composite fields are written nested.
      const patch: Record<string, unknown> = {};

      if (!keeper.emails?.primaryEmail) {
        const d = duplicates.find((x) => x.emails?.primaryEmail);

        if (d) patch.emails = { primaryEmail: d.emails!.primaryEmail };
      }

      if (!keeper.phones?.primaryPhoneNumber) {
        const d = duplicates.find((x) => x.phones?.primaryPhoneNumber);

        if (d) {
          patch.phones = {
            primaryPhoneNumber: d.phones!.primaryPhoneNumber,
            primaryPhoneCountryCode: d.phones!.primaryPhoneCountryCode,
            primaryPhoneCallingCode: d.phones!.primaryPhoneCallingCode,
          };
        }
      }

      if (!keeper.name?.firstName) {
        const d = duplicates.find((x) => x.name?.firstName);

        if (d) {
          patch.name = {
            firstName: d.name!.firstName,
            lastName: d.name!.lastName,
          };
        }
      }

      if (!keeper.companyId) {
        const d = duplicates.find((x) => x.companyId);

        if (d) patch.companyId = d.companyId;
      }

      if (Object.keys(patch).length > 0) {
        patch.updatedBy = SYSTEM_ACTOR;
        await personRepository.update({ id: keeper.id }, patch);
      }

      // 3) Soft-delete the merged-away duplicates.
      for (const dup of duplicates) {
        try {
          await personRepository.softDelete({ id: dup.id });
        } catch (error) {
          this.logger.warn(
            `Soft-delete duplicate ${dup.id} failed: ${
              (error as Error).message
            }`,
          );
        }
      }

      this.logger.log(
        `Merged ${duplicateIds.length} duplicate(s) into person ${keeper.id}.`,
      );

      return { keeperId: keeper.id, mergedIds: duplicateIds };
    }, systemAuthContext);
  }
}
