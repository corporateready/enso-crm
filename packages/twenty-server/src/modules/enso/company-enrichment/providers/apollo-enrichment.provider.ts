import { Injectable, Logger } from '@nestjs/common';

import { type AxiosInstance } from 'axios';
import { isDefined } from 'twenty-shared/utils';

import { SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';
import {
  type CompanyEnrichmentInput,
  type CompanyEnrichmentProvider,
  type PartialCompanyEnrichment,
} from 'src/modules/enso/company-enrichment/providers/company-enrichment-provider.interface';

// Apollo.io Organization Enrichment — broad, domain-keyed firmographics (industry,
// employees, revenue, founded year, social links, phone, HQ address). Fits our
// domain-triggered flow directly (no name/IDNO bridge needed) and is available on
// Apollo's FREE plan (~600 calls/day). Apollo does NOT provide a registered legal
// name — that gap is filled by the Moldova/data2b provider later in the chain.
//
//   GET {base}/organizations/enrich?domain=<domain>
//   header: X-Api-Key: <key>
//   response: { organization: { ...firmographics } }; 429 on rate/credit limit.
//
// Config (no key → provider silently disabled):
//   ENSO_APOLLO_API_KEY   required
//   ENSO_APOLLO_BASE_URL  optional override (default below)
const DEFAULT_BASE_URL = 'https://api.apollo.io/api/v1';

type ApolloOrganization = Record<string, any>;

@Injectable()
export class ApolloEnrichmentProvider implements CompanyEnrichmentProvider {
  readonly providerName = 'apollo';
  private readonly logger = new Logger(ApolloEnrichmentProvider.name);
  private readonly httpClient: AxiosInstance;
  private readonly apiKey = process.env.ENSO_APOLLO_API_KEY;

  constructor(
    private readonly secureHttpClientService: SecureHttpClientService,
  ) {
    this.httpClient = this.secureHttpClientService.getHttpClient({
      baseURL: process.env.ENSO_APOLLO_BASE_URL ?? DEFAULT_BASE_URL,
    });
  }

  isEnabled(): boolean {
    return isDefined(this.apiKey) && this.apiKey.length > 0;
  }

  async enrich(
    input: CompanyEnrichmentInput,
  ): Promise<PartialCompanyEnrichment | null> {
    if (!this.isEnabled() || !input.domain) {
      return null;
    }

    let organization: ApolloOrganization | null = null;

    try {
      const response = await this.httpClient.get('/organizations/enrich', {
        params: { domain: input.domain },
        headers: {
          'X-Api-Key': this.apiKey,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
      });

      organization = response.data?.organization ?? null;
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response
        ?.status;

      if (status === 429) {
        this.logger.warn('Apollo rate/credit limit reached (429)');
      } else {
        this.logger.debug(
          `Apollo enrich failed for ${input.domain}: ${(error as Error).message}`,
        );
      }

      return null;
    }

    if (!organization) {
      return null;
    }

    return this.mapOrganization(organization);
  }

  private mapOrganization(
    org: ApolloOrganization,
  ): PartialCompanyEnrichment | null {
    const result: PartialCompanyEnrichment = {};

    if (this.isNonEmpty(org.name)) {
      result.name = org.name;
    }

    // Apollo returns the primary industry as `industry` (string) for some orgs
    // but only populates `industries` / `secondary_industries` (arrays) for
    // others — fall back through them so we don't miss it.
    const industry = this.firstNonEmptyString([
      org.industry,
      Array.isArray(org.industries) ? org.industries[0] : undefined,
      Array.isArray(org.secondary_industries)
        ? org.secondary_industries[0]
        : undefined,
    ]);

    if (this.isNonEmpty(industry)) {
      result.industry = industry;
    }

    const description = org.short_description ?? org.seo_description;

    if (this.isNonEmpty(description)) {
      result.description = description;
    }

    if (this.isPositiveNumber(org.founded_year)) {
      result.foundedYear = org.founded_year;
    }
    if (this.isPositiveNumber(org.estimated_num_employees)) {
      result.employees = org.estimated_num_employees;
    }
    if (this.isPositiveNumber(org.annual_revenue)) {
      result.annualRevenueAmount = org.annual_revenue;
    }

    if (this.isNonEmpty(org.linkedin_url)) {
      result.linkedinUrl = org.linkedin_url;
    }
    if (this.isNonEmpty(org.twitter_url)) {
      result.xUrl = org.twitter_url;
    }

    const phone = org.primary_phone?.number ?? org.phone ?? org.sanitized_phone;

    if (this.isNonEmpty(phone)) {
      result.phone = phone;
    }

    if (this.isNonEmpty(org.street_address)) {
      result.addressStreet1 = org.street_address;
    }
    if (this.isNonEmpty(org.city)) {
      result.addressCity = org.city;
    }
    if (this.isNonEmpty(org.state)) {
      result.addressState = org.state;
    }
    if (this.isNonEmpty(org.postal_code)) {
      result.addressPostcode = org.postal_code;
    }
    if (this.isNonEmpty(org.country)) {
      result.addressCountry = org.country;
    }

    return Object.keys(result).length > 0 ? result : null;
  }

  private isNonEmpty(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private firstNonEmptyString(values: unknown[]): string | undefined {
    return values.find((value) => this.isNonEmpty(value)) as string | undefined;
  }

  private isPositiveNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  }
}
