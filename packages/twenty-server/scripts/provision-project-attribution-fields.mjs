#!/usr/bin/env node
// Idempotent provisioning of the Project fields that let intake route a lead by
// its utm_campaign (see src/modules/enso/inbound-activity/services/
// campaign-project.service.ts).
//
//   utmCampaigns — the campaign slugs this project owns. Marketing's slugs name
//                  the project they promote (newton_buiucani_comercial_new_2025
//                  IS Ioana Radu), so a lead carrying one can be routed to it.
//   isUmbrella   — true for the catch-all projects that multi-project pages
//                  default to (ENSO ESTATE, ENSO LIVING, Vânzări Imobiliare).
//                  A mapped campaign may narrow an umbrella project; it never
//                  overrides a specific one.
//
// Talks to the METADATA API with a workspace API key — no DB access, safe to
// re-run: existence is checked with a top-level filtered query, because the
// nested `fields` connection on an object silently truncates.
//
// Usage:
//   TWENTY_API_URL=https://crm.enso.ro TWENTY_API_KEY=<key> \
//     node packages/twenty-server/scripts/provision-project-attribution-fields.mjs [--dry-run]

const API_URL = (process.env.TWENTY_API_URL ?? 'https://crm.enso.ro').replace(/\/$/, '');
const API_KEY = process.env.TWENTY_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');
const METADATA_ENDPOINT = `${API_URL}/metadata`;

if (!API_KEY) {
  console.error('Missing TWENTY_API_KEY env var (workspace API key).');
  process.exit(1);
}

const FIELDS = [
  {
    name: 'utmCampaigns',
    label: 'UTM Campaigns',
    type: 'ARRAY',
    icon: 'IconTargetArrow',
    description:
      'Campaign slugs (utm_campaign) that belong to this project. Leads carrying one are routed here from multi-project pages.',
  },
  {
    name: 'isUmbrella',
    label: 'Umbrella Project',
    type: 'BOOLEAN',
    icon: 'IconUmbrella',
    description:
      'Catch-all default of a multi-project page. A mapped campaign may narrow a lead from an umbrella project to a specific one.',
    defaultValue: false,
  },
];

const gql = async (query, variables) => {
  const response = await fetch(METADATA_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(JSON.stringify(json.errors, null, 2));
  }
  return json.data;
};

const fetchProjectObjectId = async () => {
  const data = await gql(`
    query Objects { objects(paging: { first: 200 }) { edges { node { id nameSingular } } } }
  `);
  const project = data.objects.edges.map((edge) => edge.node).find((node) => node.nameSingular === 'project');
  if (!project) {
    throw new Error('Could not find the "project" object in metadata.');
  }
  return project.id;
};

// FieldFilter cannot filter by name, so fetch the object's full field set once
// through the TOP-LEVEL query and check membership locally.
const fetchExistingFieldNames = async (objectMetadataId) => {
  const data = await gql(
    `query FieldsForObject($objectMetadataId: UUID!) {
      fields(paging: { first: 200 }, filter: { objectMetadataId: { eq: $objectMetadataId } }) {
        edges { node { name } }
      }
    }`,
    { objectMetadataId },
  );
  return new Set(data.fields.edges.map((edge) => edge.node.name));
};

const createField = async (objectMetadataId, field) => {
  await gql(
    `mutation CreateOneField($input: CreateOneFieldMetadataInput!) { createOneField(input: $input) { id name } }`,
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
          ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
        },
      },
    },
  );
};

const main = async () => {
  console.log(`Metadata endpoint: ${METADATA_ENDPOINT}${DRY_RUN ? ' (dry-run)' : ''}`);
  const objectMetadataId = await fetchProjectObjectId();
  console.log(`Project objectMetadataId: ${objectMetadataId}`);

  const existing = await fetchExistingFieldNames(objectMetadataId);
  console.log(`Existing Project fields: ${existing.size}`);

  for (const field of FIELDS) {
    if (existing.has(field.name)) {
      console.log(`• skip   ${field.name} (already exists)`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`• would create ${field.name} (${field.type})`);
      continue;
    }
    try {
      await createField(objectMetadataId, field);
      console.log(`✓ create ${field.name} (${field.type})`);
    } catch (error) {
      console.error(`✗ failed ${field.name}: ${error.message}`);
      process.exitCode = 1;
    }
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
