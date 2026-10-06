#!/usr/bin/env node
// Idempotent provisioning of households — the "Families" list.
//
//   household        everyone connected through family links, e.g.
//                    "Popescu Family". Derived by the server
//                    (src/modules/enso/person-relationship/services/
//                    household-sync.service.ts); managers only rename.
//   person.household the household a person belongs to (inverse: Members).
//
// The individual links (personRelationship) used to carry the "Families"
// label; they become "Family Links" so the sidebar has one Families entry.
//
//   TWENTY_API_URL=https://crm.enso.ro TWENTY_API_KEY=<key> \
//     node packages/twenty-server/scripts/provision-households.mjs [--dry-run]
//
// Afterwards: re-run provision-sales-manager-role.mjs (household is listed
// there), then REDEPLOY twenty-server and twenty-worker so their ORM metadata
// cache picks the object up.

const API_URL = (process.env.TWENTY_API_URL ?? 'https://crm.enso.ro').replace(/\/$/, '');
const API_KEY = process.env.TWENTY_API_KEY;
const DRY = process.argv.includes('--dry-run');
const ENDPOINT = `${API_URL}/metadata`;

if (!API_KEY) {
  console.error('Missing TWENTY_API_KEY');
  process.exit(1);
}

const gql = async (query, variables) => {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(JSON.stringify(json.errors, null, 2));
  return json.data;
};

const listObjects = async () => {
  const data = await gql(
    `query { objects(paging:{first:300}) { edges { node { id nameSingular labelSingular labelPlural } } } }`,
  );
  return new Map(data.objects.edges.map((e) => [e.node.nameSingular, e.node]));
};

// Deliberately NOT the nested `fields` connection on `objects`: it silently
// truncates, so a field that exists would read as missing and be re-created.
const listFields = async (objectMetadataId) => {
  const { fields } = await gql(
    `query($objectMetadataId: UUID!) {
      fields(paging: { first: 300 }, filter: { objectMetadataId: { eq: $objectMetadataId } }) {
        edges { node { id name label } }
      }
    }`,
    { objectMetadataId },
  );
  return new Map(fields.edges.map((e) => [e.node.name, e.node]));
};

const relabelObject = async (object, labelSingular, labelPlural) => {
  if (object.labelSingular === labelSingular && object.labelPlural === labelPlural) {
    console.log(`• ${object.nameSingular} already labelled ${labelPlural}`);
    return;
  }
  if (DRY) {
    console.log(`• would relabel ${object.nameSingular}: ${object.labelPlural} → ${labelPlural}`);
    return;
  }
  await gql(
    `mutation($input: UpdateOneObjectInput!){ updateOneObject(input:$input){ id } }`,
    { input: { id: object.id, update: { labelSingular, labelPlural, isLabelSyncedWithName: false } } },
  );
  console.log(`✓ relabelled ${object.nameSingular} → ${labelPlural}`);
};

const relabelField = async (field, label, owner) => {
  if (!field) {
    console.log(`• ${owner} field not found, skipping relabel`);
    return;
  }
  if (field.label === label) {
    console.log(`• ${owner}.${field.name} already labelled ${label}`);
    return;
  }
  if (DRY) {
    console.log(`• would relabel ${owner}.${field.name}: ${field.label} → ${label}`);
    return;
  }
  await gql(
    `mutation($input: UpdateOneFieldMetadataInput!){ updateOneField(input:$input){ id } }`,
    { input: { id: field.id, update: { label } } },
  );
  console.log(`✓ relabelled ${owner}.${field.name} → ${label}`);
};

const main = async () => {
  console.log(`Endpoint: ${ENDPOINT}${DRY ? ' (dry-run)' : ''}`);
  const objects = await listObjects();

  const person = objects.get('person');
  const relationship = objects.get('personRelationship');
  if (!person || !relationship) throw new Error('person or personRelationship object not found');

  // 1) Free the "Families" label for households.
  await relabelObject(relationship, 'Family Link', 'Family Links');
  const personFields = await listFields(person.id);
  await relabelField(personFields.get('relationships'), 'Family Links', 'person');

  // 2) The household object.
  let householdId = objects.get('household')?.id;
  if (householdId) {
    console.log(`• object exists: household (${householdId})`);
  } else if (DRY) {
    console.log('• would create object household (Family / Families)');
  } else {
    const data = await gql(
      `mutation($input: CreateOneObjectInput!){ createOneObject(input:$input){ id } }`,
      {
        input: {
          object: {
            nameSingular: 'household',
            namePlural: 'households',
            labelSingular: 'Family',
            labelPlural: 'Families',
            icon: 'IconUsers',
            description:
              'Everyone connected through family links. Kept up to date from the links; rename freely.',
          },
        },
      },
    );
    householdId = data.createOneObject.id;
    console.log(`✓ object created: household (${householdId})`);
  }

  // 3) person.household → household (inverse: Members).
  if (personFields.has('household')) {
    console.log('• skip person.household');
  } else if (DRY || !householdId) {
    console.log('• would create field person.household (RELATION → household)');
  } else {
    await gql(
      `mutation($input: CreateOneFieldMetadataInput!){ createOneField(input:$input){ id } }`,
      {
        input: {
          field: {
            objectMetadataId: person.id,
            name: 'household',
            label: 'Family',
            type: 'RELATION',
            icon: 'IconUsers',
            isNullable: true,
            relationCreationPayload: {
              type: 'MANY_TO_ONE',
              targetObjectMetadataId: householdId,
              targetFieldLabel: 'Members',
              targetFieldIcon: 'IconUser',
            },
          },
        },
      },
    );
    console.log('✓ field person.household (RELATION → household)');
  }

  console.log('done.');
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
