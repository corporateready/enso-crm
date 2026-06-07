import { Injectable } from '@nestjs/common';

import { getCompanyNameFromDomainName } from 'src/modules/contact-creation-manager/utils/get-company-name-from-domain-name.util';
import {
  type CompanyEnrichmentInput,
  type CompanyEnrichmentProvider,
  type PartialCompanyEnrichment,
} from 'src/modules/enso/company-enrichment/providers/company-enrichment-provider.interface';

// Offline baseline: derive a display name from the registrable domain
// ("acme.ro" -> "Acme"). Always first in the chain and always enabled so the
// company never ends up nameless even if every network provider is down.
@Injectable()
export class DomainDerivedEnrichmentProvider implements CompanyEnrichmentProvider {
  readonly providerName = 'domain-derived';

  isEnabled(): boolean {
    return true;
  }

  async enrich(
    input: CompanyEnrichmentInput,
  ): Promise<PartialCompanyEnrichment | null> {
    const name = getCompanyNameFromDomainName(input.domain);

    if (!name) {
      return null;
    }

    return { name };
  }
}
