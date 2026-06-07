#!/usr/bin/env node
// Idempotent provisioning of the custom Company fields used by company
// auto-creation + enrichment (see src/modules/enso/company-enrichment).
//
// Talks to the running server's METADATA GraphQL API (/metadata) with a
// workspace API key — no DB access, safe to run against any environment, and
// re-runnable: it queries existing Company fields first and only creates the
// missing ones.
//
// Usage:
//   TWENTY_API_URL=https://crm.enso.ro \
//   TWENTY_API_KEY=<workspace api key from Settings → APIs & Webhooks> \
//   node packages/twenty-server/scripts/provision-company-enrichment-fields.mjs
//
//   Add --dry-run to print what would be created without writing.
//
// The field NAMES here must match what the enrichment code reads/writes:
//   legalName, industry, registrationNumber, description, foundedYear,
//   companyPhone, enrichmentStatus, enrichedAt
// Keep the SELECT options in sync with company-enrichment.constants.ts.

const API_URL = (process.env.TWENTY_API_URL ?? 'https://crm.enso.ro').replace(/\/$/, '');
const API_KEY = process.env.TWENTY_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');
const METADATA_ENDPOINT = `${API_URL}/metadata`;

if (!API_KEY) {
  console.error('Missing TWENTY_API_KEY env var (workspace API key).');
  process.exit(1);
}

const COLORS = [
  'green', 'turquoise', 'sky', 'blue', 'purple',
  'pink', 'red', 'orange', 'yellow', 'gray',
];

// value === GraphQL enum name (UPPER_SNAKE); label is human-facing.
const toOptions = (entries) =>
  entries.map(([value, label], index) => ({
    value,
    label,
    color: COLORS[index % COLORS.length],
    position: index,
  }));

const INDUSTRY_OPTIONS = toOptions([
  ['AGRICULTURE', 'Agriculture'],
  ['AUTOMOTIVE', 'Automotive'],
  ['CONSTRUCTION', 'Construction'],
  ['CONSUMER_GOODS', 'Consumer Goods'],
  ['EDUCATION', 'Education'],
  ['ENERGY', 'Energy'],
  ['ENTERTAINMENT_MEDIA', 'Entertainment & Media'],
  ['FINANCE_INSURANCE', 'Finance & Insurance'],
  ['FOOD_BEVERAGE', 'Food & Beverage'],
  ['GOVERNMENT', 'Government'],
  ['HEALTHCARE', 'Healthcare'],
  ['HOSPITALITY_TOURISM', 'Hospitality & Tourism'],
  ['INFORMATION_TECHNOLOGY', 'Information Technology'],
  ['LEGAL_SERVICES', 'Legal Services'],
  ['LOGISTICS_TRANSPORT', 'Logistics & Transport'],
  ['MANUFACTURING', 'Manufacturing'],
  ['MARKETING_ADVERTISING', 'Marketing & Advertising'],
  ['NON_PROFIT', 'Non-profit'],
  ['PHARMACEUTICALS', 'Pharmaceuticals'],
  ['PROFESSIONAL_SERVICES', 'Professional Services'],
  ['REAL_ESTATE', 'Real Estate'],
  ['RETAIL_ECOMMERCE', 'Retail & E-commerce'],
  ['TELECOMMUNICATIONS', 'Telecommunications'],
  ['UTILITIES', 'Utilities'],
  ['WHOLESALE_DISTRIBUTION', 'Wholesale & Distribution'],
  ['OTHER', 'Other'],
]);

const ENRICHMENT_STATUS_OPTIONS = toOptions([
  ['PENDING', 'Pending'],
  ['ENRICHED', 'Enriched'],
  ['PARTIAL', 'Partial'],
  ['FAILED', 'Failed'],
  ['SKIPPED', 'Skipped'],
]);

// Each entry maps directly onto a CreateFieldInput.
const FIELDS = [
  { name: 'legalName', label: 'Legal Name', type: 'TEXT', icon: 'IconLicense',
    description: 'Registered legal entity name' },
  { name: 'industry', label: 'Industry', type: 'SELECT', icon: 'IconBuildingFactory2',
    description: 'Primary industry', options: INDUSTRY_OPTIONS },
  { name: 'registrationNumber', label: 'Registration Number', type: 'TEXT', icon: 'IconId',
    description: 'VAT / fiscal code (RO CUI, MD IDNO, EU VAT)' },
  { name: 'description', label: 'Description', type: 'TEXT', icon: 'IconFileDescription',
    description: 'Company description' },
  { name: 'foundedYear', label: 'Founded Year', type: 'NUMBER', icon: 'IconCalendar',
    description: 'Year the company was founded' },
  { name: 'companyPhone', label: 'Phone', type: 'PHONES', icon: 'IconPhone',
    description: 'Company phone number' },
  { name: 'enrichmentStatus', label: 'Enrichment Status', type: 'SELECT', icon: 'IconSparkles',
    description: 'Auto-enrichment state', options: ENRICHMENT_STATUS_OPTIONS },
  { name: 'enrichedAt', label: 'Enriched At', type: 'DATE_TIME', icon: 'IconClockCheck',
    description: 'Last successful enrichment timestamp' },
  { name: 'enrichmentSource', label: 'Enrichment Source', type: 'TEXT', icon: 'IconDatabaseImport',
    description: 'Providers that contributed data (provenance; e.g. apollo, twenty-companies)' },
];

const gql = async (query, variables) => {
  const response = await fetch(METADATA_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await response.json();

  if (json.errors?.length) {
    throw new Error(JSON.stringify(json.errors, null, 2));
  }

  return json.data;
};

const fetchCompanyObject = async () => {
  const data = await gql(`
    query Objects {
      objects(paging: { first: 200 }) {
        edges {
          node {
            id
            nameSingular
            fields(paging: { first: 300 }) {
              edges { node { name } }
            }
          }
        }
      }
    }
  `);

  const company = data.objects.edges
    .map((edge) => edge.node)
    .find((node) => node.nameSingular === 'company');

  if (!company) {
    throw new Error('Could not find the "company" object in metadata.');
  }

  const existingFieldNames = new Set(
    company.fields.edges.map((edge) => edge.node.name),
  );

  return { objectMetadataId: company.id, existingFieldNames };
};

const createField = async (objectMetadataId, field) => {
  await gql(
    `
    mutation CreateOneField($input: CreateOneFieldMetadataInput!) {
      createOneField(input: $input) { id name }
    }
  `,
    {
      input: {
        field: {
          objectMetadataId,
          name: field.name,
          label: field.label,
          type: field.type,
          description: field.description,
          icon: field.icon,
          isNullable: true,
          ...(field.options ? { options: field.options } : {}),
        },
      },
    },
  );
};

const main = async () => {
  console.log(`Metadata endpoint: ${METADATA_ENDPOINT}${DRY_RUN ? ' (dry-run)' : ''}`);

  const { objectMetadataId, existingFieldNames } = await fetchCompanyObject();
  console.log(`Company objectMetadataId: ${objectMetadataId}`);

  let created = 0;
  let skipped = 0;

  for (const field of FIELDS) {
    if (existingFieldNames.has(field.name)) {
      console.log(`• skip   ${field.name} (already exists)`);
      skipped += 1;
      continue;
    }

    if (DRY_RUN) {
      console.log(`• would create ${field.name} (${field.type})`);
      continue;
    }

    try {
      await createField(objectMetadataId, field);
      console.log(`✓ create ${field.name} (${field.type})`);
      created += 1;
    } catch (error) {
      console.error(`✗ failed ${field.name}: ${error.message}`);
      process.exitCode = 1;
    }
  }

  console.log(`\nDone. created=${created} skipped=${skipped}${DRY_RUN ? ' (dry-run)' : ''}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
