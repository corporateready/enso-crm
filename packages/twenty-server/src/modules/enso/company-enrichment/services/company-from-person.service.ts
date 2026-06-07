import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';
import { ILike } from 'typeorm';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { extractDomainFromLink } from 'src/modules/contact-creation-manager/utils/extract-domain-from-link.util';
import { getCompanyNameFromDomainName } from 'src/modules/contact-creation-manager/utils/get-company-name-from-domain-name.util';
import { getDomainNameFromHandle } from 'src/modules/contact-creation-manager/utils/get-domain-name-from-handle.util';
import {
  COMPANY_ENRICHMENT_STATUS,
  SYSTEM_ACTOR,
} from 'src/modules/enso/company-enrichment/company-enrichment.constants';
import { isWorkEmail } from 'src/utils/is-work-email';

export type ResolveCompanyOutcome = {
  companyId: string;
  // true when this run created (or restored) the company — only then is a fresh
  // enrichment pass worth enqueueing.
  created: boolean;
};

// Given a freshly created/updated person, create-or-restore the Company for the
// person's WORK-email domain and link the person to it. Personal-email leads
// (Gmail/Yahoo/…) produce no company. Idempotent: dedups by registrable domain
// and un-soft-deletes a previously deleted company instead of duplicating it.
@Injectable()
export class CompanyFromPersonService {
  private readonly logger = new Logger(CompanyFromPersonService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async resolveFromPerson(
    workspaceId: string,
    personId: string,
  ): Promise<ResolveCompanyOutcome | null> {
    if (!isDefined(workspaceId) || !isDefined(personId)) {
      return null;
    }

    const systemAuthContext = buildSystemAuthContext(workspaceId);

    try {
      return await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const personRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'person',
              { shouldBypassPermissionChecks: true },
            );

          const person = await personRepository.findOne({
            where: { id: personId },
          });

          // Already linked — don't reassign a person's company on later edits.
          if (!person || isDefined(person.companyId)) {
            return null;
          }

          const domain = this.extractWorkDomain(person);

          if (!domain) {
            return null;
          }

          const companyRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'company',
              { shouldBypassPermissionChecks: true },
            );

          const { companyId, created } = await this.findOrCreateCompany(
            companyRepository,
            domain,
          );

          await personRepository.update(
            { id: personId },
            { companyId, updatedBy: SYSTEM_ACTOR },
          );

          return { companyId, created };
        },
        systemAuthContext,
      );
    } catch (error) {
      this.logger.warn(
        `Company resolution failed for person ${personId}: ${(error as Error).message}`,
      );

      return null;
    }
  }

  // First work email wins (primary, then additional). Returns the registrable
  // domain ("acme.ro") or null when the person has only personal-provider emails.
  private extractWorkDomain(person: {
    emails?: { primaryEmail?: string | null; additionalEmails?: string[] | null };
  }): string | null {
    const candidates = [
      person.emails?.primaryEmail,
      ...(person.emails?.additionalEmails ?? []),
    ].filter((email): email is string => isDefined(email) && email.length > 0);

    for (const email of candidates) {
      if (!isWorkEmail(email)) {
        continue;
      }

      const domain = getDomainNameFromHandle(email);

      if (domain) {
        return domain;
      }
    }

    return null;
  }

  private async findOrCreateCompany(
    companyRepository: any,
    domain: string,
  ): Promise<ResolveCompanyOutcome> {
    const existingCompanies = await companyRepository.find({
      where: { domainName: { primaryLinkUrl: ILike(`%${domain}%`) } },
      withDeleted: true,
    });

    // ILIKE can over-match (e.g. "acme.ro" vs "notacme.rocks"); confirm the
    // registrable domain matches exactly.
    const existing = existingCompanies.find(
      (company: { domainName?: { primaryLinkUrl?: string } }) =>
        isDefined(company.domainName?.primaryLinkUrl) &&
        extractDomainFromLink(company.domainName.primaryLinkUrl) === domain,
    );

    if (existing) {
      if (isDefined(existing.deletedAt)) {
        await companyRepository.update(
          { id: existing.id },
          { deletedAt: null, updatedBy: SYSTEM_ACTOR },
        );

        return { companyId: existing.id, created: true };
      }

      return { companyId: existing.id, created: false };
    }

    const lastPosition = (await companyRepository.maximum('position', undefined)) ?? 0;

    const created = await companyRepository.save({
      name: getCompanyNameFromDomainName(domain),
      domainName: { primaryLinkUrl: `https://${domain}` },
      enrichmentStatus: COMPANY_ENRICHMENT_STATUS.PENDING,
      position: lastPosition + 1,
      createdBy: SYSTEM_ACTOR,
      updatedBy: SYSTEM_ACTOR,
    });

    return { companyId: created.id, created: true };
  }
}
