import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';
import { ILike, IsNull, Not } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import {
  arePhonesSameLine,
  phoneShortlistSuffix,
} from 'src/modules/enso/person-merge/utils/phone-match.util';
import { escapeLikePattern } from 'src/modules/enso/shared/utils/escape-like-pattern.util';

// Person rows come back from the workspace ORM with NESTED composite fields
// (emails.primaryEmail, phones.primaryPhoneNumber), not flat columns.
type PersonRow = {
  id: string;
  emails?: { primaryEmail?: string | null } | null;
  phones?: { primaryPhoneNumber?: string | null } | null;
};

// Finds OTHER active people that share the trigger person's email or phone.
// Returns the full duplicate set (trigger + matches) or null when there's
// nothing to reconcile.
//
// The phone arm shortlists in SQL and CONFIRMS in code, because stored phones
// are inconsistently shaped and a suffix test alone both over- and under-matches
// (see phone-match.util). Same split as call-identity.service.
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

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
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

        const email = (me.emails?.primaryEmail || '').trim().toLowerCase();
        const myPhone = me.phones?.primaryPhoneNumber;
        const phoneSuffix = phoneShortlistSuffix(myPhone);

        // No contact key to dedup on (e.g. a name-only social contact) → nothing
        // to do until a phone/email is added.
        if (!email && !phoneSuffix) {
          return null;
        }

        const matchIds = new Set<string>();

        // Composite fields are TypeORM embedded columns → nested where.
        if (email) {
          const byEmail: PersonRow[] = await personRepository.find({
            where: {
              emails: { primaryEmail: ILike(escapeLikePattern(email)) },
              id: Not(personId),
              deletedAt: IsNull(),
            },
          });

          for (const p of byEmail) matchIds.add(p.id);
        }

        if (phoneSuffix) {
          const candidates: PersonRow[] = await personRepository.find({
            where: {
              phones: { primaryPhoneNumber: ILike(`%${phoneSuffix}`) },
              id: Not(personId),
              deletedAt: IsNull(),
            },
          });

          // The shortlist is deliberately wide: it also returns longer numbers
          // that merely END with the same digits ('2123456789' for '123456789'),
          // which are different lines. Only confirmed matches count.
          for (const p of candidates) {
            if (arePhonesSameLine(myPhone, p.phones?.primaryPhoneNumber)) {
              matchIds.add(p.id);
            }
          }
        }

        if (matchIds.size === 0) {
          return null;
        }

        this.logger.log(
          `Person ${personId} has ${matchIds.size} phone/email duplicate(s).`,
        );

        return [personId, ...matchIds];
      },
      systemAuthContext,
    );
  }
}
