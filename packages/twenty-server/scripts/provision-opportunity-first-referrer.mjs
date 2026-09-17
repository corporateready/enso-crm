#!/usr/bin/env node
// Idempotent provisioning of the Opportunity `firstReferrer` TEXT field — the
// referring site of the touch that opened the deal, the first-touch companion
// to `firstLandingPage`. Re-runnable (skips if the field exists).
//
//   TWENTY_API_URL=https://crm.enso.ro TWENTY_API_KEY=<key> \
//     node packages/twenty-server/scripts/provision-opportunity-first-referrer.mjs [--dry-run]
//
// NOTE: after creating the field, REDEPLOY twenty-worker so its ORM metadata
// cache picks it up (else opportunity-resolution writes to firstReferrer are
// silently dropped).
//
// First-touch only, deliberately: the deal's LAST-touch block carries
// lastTrafficType + lastUtm* but no landing page, so a referrer there would be
// the only last-touch page-level field and would read as an oversight on the
// other one.

const API_URL = (process.env.TWENTY_API_URL ?? 'https://crm.enso.ro').replace(/\/$/, '');
const API_KEY = process.env.TWENTY_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');
const ENDPOINT = `${API_URL}/metadata`;

if (!API_KEY) {
  console.error('Missing TWENTY_API_KEY');
  process.exit(1);
}

const FIELD = {
  name: 'firstReferrer',
  label: 'First Referrer',
  type: 'TEXT',
  icon: 'IconExternalLink',
  description:
    'Referring site of the touch that opened this deal. "direct" when the visitor arrived with no referrer.',
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
        edges { node { id nameSingular } }
      }
    }
  `);

  const opportunity = data.objects.edges
    .map((edge) => edge.node)
    .find((node) => node.nameSingular === 'opportunity');

  if (!opportunity) {
    throw new Error('Could not find the "opportunity" object.');
  }

  console.log(`Opportunity objectMetadataId: ${opportunity.id}`);

  // The NESTED `fields` connection on `objects` silently truncates whatever
  // paging it is given, so a check built on it reports a field absent and this
  // script tries to re-create it on every run. Ask the top-level `fields` query
  // filtered to the one object instead.
  const { fields } = await gql(
    `query FieldsForObject($objectMetadataId: UUID!) {
      fields(
        paging: { first: 200 }
        filter: { objectMetadataId: { eq: $objectMetadataId } }
      ) {
        edges { node { id name type } }
      }
    }`,
    { objectMetadataId: opportunity.id },
  );

  const existing = new Set(fields.edges.map((edge) => edge.node.name));

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
