import { Module } from '@nestjs/common';

import { SecureHttpClientModule } from 'src/engine/core-modules/secure-http-client/secure-http-client.module';
import { EnrichCompanyJob } from 'src/modules/enso/company-enrichment/jobs/enrich-company.job';
import { ResolveCompanyFromPersonJob } from 'src/modules/enso/company-enrichment/jobs/resolve-company-from-person.job';
import { ApolloEnrichmentProvider } from 'src/modules/enso/company-enrichment/providers/apollo-enrichment.provider';
import { COMPANY_ENRICHMENT_PROVIDERS } from 'src/modules/enso/company-enrichment/providers/company-enrichment-provider.interface';
import { DomainDerivedEnrichmentProvider } from 'src/modules/enso/company-enrichment/providers/domain-derived-enrichment.provider';
import { MoldovaData2bEnrichmentProvider } from 'src/modules/enso/company-enrichment/providers/moldova-data2b-enrichment.provider';
import { TwentyCompaniesEnrichmentProvider } from 'src/modules/enso/company-enrichment/providers/twenty-companies-enrichment.provider';
import { CompanyEnrichmentService } from 'src/modules/enso/company-enrichment/services/company-enrichment.service';
import { CompanyFromPersonService } from 'src/modules/enso/company-enrichment/services/company-from-person.service';

// WORKER side of company auto-creation: the two BullMQ jobs (resolve → enrich),
// the services they depend on, and the ordered enrichment-provider chain.
// Imported by JobsModule, which the queue worker (QueueWorkerModule) loads —
// that's where the message-queue explorer discovers @Processor classes. The
// server-side POST hooks live in CompanyEnrichmentModule.
//
// COMPANY_ENRICHMENT_PROVIDERS is the chain, ordered cheap→rich: a later
// provider's non-empty values override an earlier one's (see the provider
// interface). To add a paid provider, append it after the registry provider.
@Module({
  imports: [SecureHttpClientModule],
  providers: [
    DomainDerivedEnrichmentProvider,
    TwentyCompaniesEnrichmentProvider,
    ApolloEnrichmentProvider,
    MoldovaData2bEnrichmentProvider,
    {
      // Chain order = quality, low → high (later non-empty wins). Apollo is the
      // broad firmographics workhorse (domain-keyed, free tier). data2b runs last
      // so its MD legal name / IDNO fill gaps without clobbering Apollo's data.
      // Disabled providers (no key) are skipped at runtime.
      provide: COMPANY_ENRICHMENT_PROVIDERS,
      useFactory: (
        domainDerived: DomainDerivedEnrichmentProvider,
        twentyCompanies: TwentyCompaniesEnrichmentProvider,
        apollo: ApolloEnrichmentProvider,
        moldovaData2b: MoldovaData2bEnrichmentProvider,
      ) => [domainDerived, twentyCompanies, apollo, moldovaData2b],
      inject: [
        DomainDerivedEnrichmentProvider,
        TwentyCompaniesEnrichmentProvider,
        ApolloEnrichmentProvider,
        MoldovaData2bEnrichmentProvider,
      ],
    },
    CompanyFromPersonService,
    CompanyEnrichmentService,
    ResolveCompanyFromPersonJob,
    EnrichCompanyJob,
  ],
})
export class CompanyEnrichmentJobsModule {}
