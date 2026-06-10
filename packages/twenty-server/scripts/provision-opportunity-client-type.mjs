#!/usr/bin/env node
// Idempotent provisioning of the Opportunity `dealType` SELECT field (B2B/B2C)
// used by the B2B account-deals work. Talks to the running /metadata GraphQL API
// with a workspace API key — re-runnable (skips if the field exists).
//
//   TWENTY_API_URL=https://crm.enso.ro TWENTY_API_KEY=<key> \
//     node packages/twenty-server/scripts/provision-opportunity-deal-type.mjs [--dry-run]
//
// NOTE: after creating the field, REDEPLOY twenty-worker so its ORM metadata
// cache picks it up (else opportunity-resolution writes to dealType are dropped).

const API_URL = (process.env.TWENTY_API_URL ?? 'https://crm.enso.ro').replace(/\/$/, '');
const API_KEY = process.env.TWENTY_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');
const ENDPOINT = `${API_URL}/metadata`;

if (!API_KEY) {
  console.error('Missing TWENTY_API_KEY');
  process.exit(1);
}

// NOTE: NOT `dealType` — that already exists on Opportunity and means the SALE
// type (Primary/Resale/Lease/…). This is the orthogonal B2B/B2C axis.
const FIELD = {
  name: 'clientType',
  label: 'Client Type',
  type: 'SELECT',
  icon: 'IconBuildingSkyscraper',
  description: 'B2B (company account) vs B2C (individual)',
  options: [
    { value: 'B2B', label: 'B2B', color: 'blue', position: 0 },
    { value: 'B2C', label: 'B2C', color: 'green', position: 1 },
  ],
};

const gql = async (query, variables) => {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();

  if (json.errors?.length) {
    throw new Error(JSON.stringify(json.errors, null, 2));
  }

  return json.data;
};

const main = async () => {
  console.log(`Metadata endpoint: ${ENDPOINT}${DRY_RUN ? ' (dry-run)' : ''}`);

  const data = await gql(`
    query {
      objects(paging: { first: 200 }) {
        edges { node { id nameSingular fields(paging: { first: 500 }) { edges { node { name } } } } }
      }
    }
  `);

  const opportunity = data.objects.edges
    .map((e) => e.node)
    .find((n) => n.nameSingular === 'opportunity');

  if (!opportunity) {
    throw new Error('Could not find the "opportunity" object.');
  }

  console.log(`Opportunity objectMetadataId: ${opportunity.id}`);

  const existing = new Set(opportunity.fields.edges.map((e) => e.node.name));

  if (existing.has(FIELD.name)) {
    console.log(`• skip ${FIELD.name} (already exists)`);

    return;
  }

  if (DRY_RUN) {
    console.log(`• would create ${FIELD.name} (${FIELD.type})`);

    return;
  }

  await gql(
    `mutation CreateOneField($input: CreateOneFieldMetadataInput!) {
       createOneField(input: $input) { id name }
     }`,
    {
      input: {
        field: {
          objectMetadataId: opportunity.id,
          name: FIELD.name,
          label: FIELD.label,
          type: FIELD.type,
          description: FIELD.description,
          icon: FIELD.icon,
          isNullable: true,
          options: FIELD.options,
        },
      },
    },
  );

  console.log(`✓ create ${FIELD.name} (${FIELD.type})`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
