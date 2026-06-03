import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';
import { ILike, IsNull, Not } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { PHONE_MATCH_DIGITS } from 'src/modules/enso/person-merge/person-merge.constants';

type PersonRow = {
  id: string;
  primaryEmail?: string | null;
  primaryPhoneNumber?: string | null;
  deletedAt?: Date | null;
};

// Finds OTHER active people that share the trigger person's email or phone
// (last-9 national digits). Returns the full duplicate set (trigger + matches)
// or null when there's nothing to reconcile.
@Injectable()
export class PersonDuplicateFinderService {
  private readonly logger = new Logger(PersonDuplicateFinderService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async findDuplicateSet(
    authContext: WorkspaceAuthContext,
    personId: string,
  ): Promise<string[] | null> {
    const workspaceId = authContext.workspace?.id;

    if (!workspaceId || !isDefined(personId)) {
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

      const me: PersonRow | null = await personRepository.findOne({
        where: { id: personId },
      });

      if (!me) {
        return null;
      }

      const email = (me.primaryEmail || '').trim().toLowerCase();
      const phoneDigits = (me.primaryPhoneNumber || '').replace(/\D/g, '');
      const last9 =
        phoneDigits.length >= 7 ? phoneDigits.slice(-PHONE_MATCH_DIGITS) : null;

      // No contact key to dedup on (e.g. a name-only social contact) → nothing
      // to do until a phone/email is added.
      if (!email && !last9) {
        return null;
      }

      const matches = new Map<string, PersonRow>();

      if (email) {
        const byEmail: PersonRow[] = await personRepository.find({
          where: {
            primaryEmail: ILike(email),
            id: Not(personId),
            deletedAt: IsNull(),
          },
        });

        for (const p of byEmail) matches.set(p.id, p);
      }

      if (last9) {
        const byPhone: PersonRow[] = await personRepository.find({
          where: {
            primaryPhoneNumber: ILike(`%${last9}`),
            id: Not(personId),
            deletedAt: IsNull(),
          },
        });

        for (const p of byPhone) matches.set(p.id, p);
      }

      if (matches.size === 0) {
        return null;
      }

      this.logger.log(
        `Person ${personId} has ${matches.size} phone/email duplicate(s).`,
      );

      return [personId, ...matches.keys()];
    }, systemAuthContext);
  }
}
