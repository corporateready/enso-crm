#!/usr/bin/env node
// Idempotent provisioning of the `companyProjectAssignment` custom object
// (durable B2B account ownership: company × project → manager), mirroring
// personProjectAssignment. Talks to the running /metadata GraphQL API.
//
//   TWENTY_API_URL=https://crm.enso.ro TWENTY_API_KEY=<key> \
//     node packages/twenty-server/scripts/provision-company-project-assignment.mjs [--dry-run]
//
// After creating the object, REDEPLOY twenty-worker so its ORM metadata cache
// picks it up before any code writes to it.

const API_URL = (process.env.TWENTY_API_URL ?? 'https://crm.enso.ro').replace(/\/$/, '');
const API_KEY = process.env.TWENTY_API_KEY;
const DRY = process.argv.includes('--dry-run');
const ENDPOINT = `${API_URL}/metadata`;

if (!API_KEY) {
  console.error('Missing TWENTY_API_KEY');
  process.exit(1);
}

// Resolved target object ids (single prod workspace).
const COMPANY_ID = 'adf37f19-46e1-419b-a27d-29ef4f11ae36';
const PROJECT_ID = '0b6820aa-9926-437a-b877-047ed916525c';
const WORKSPACE_MEMBER_ID = 'b3c22c83-033d-4c0c-a312-8fcfedba7e55';

const INVERSE_LABEL = 'Company Project Assignments';

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

const findObject = async () => {
  const data = await gql(`query { objects(paging:{first:300}) { edges { node { id nameSingular fields(paging:{first:200}){edges{node{name}}} } } } }`);
  return data.objects.edges.map((e) => e.node).find((n) => n.nameSingular === 'companyProjectAssignment');
};

const createField = (field) =>
  gql(`mutation($input: CreateOneFieldMetadataInput!){ createOneField(input:$input){ id name } }`, { input: { field } });

const main = async () => {
  console.log(`Endpoint: ${ENDPOINT}${DRY ? ' (dry-run)' : ''}`);
  let obj = await findObject();

  if (!obj) {
    if (DRY) { console.log('• would create object companyProjectAssignment'); return; }
    const data = await gql(
      `mutation($input: CreateOneObjectInput!){ createOneObject(input:$input){ id nameSingular } }`,
      { input: { object: {
        nameSingular: 'companyProjectAssignment',
        namePlural: 'companyProjectAssignments',
        labelSingular: 'Company Project Assignment',
        labelPlural: 'Company Project Assignments',
        icon: 'IconBriefcase',
        description: 'Durable B2B account ownership: company × project → manager.',
      } } },
    );
    obj = data.createOneObject;
    console.log(`✓ object created: ${obj.id}`);
  } else {
    console.log(`• object exists: ${obj.id}`);
  }

  const existing = new Set((obj.fields?.edges ?? []).map((e) => e.node.name));
  const objectMetadataId = obj.id;

  const fields = [
    { name: 'company', label: 'Company', type: 'RELATION', icon: 'IconBuildingSkyscraper',
      relationCreationPayload: { type: 'MANY_TO_ONE', targetObjectMetadataId: COMPANY_ID, targetFieldLabel: INVERSE_LABEL, targetFieldIcon: 'IconBriefcase' } },
    { name: 'project', label: 'Project', type: 'RELATION', icon: 'IconBuildingCommunity',
      relationCreationPayload: { type: 'MANY_TO_ONE', targetObjectMetadataId: PROJECT_ID, targetFieldLabel: INVERSE_LABEL, targetFieldIcon: 'IconBriefcase' } },
    { name: 'manager', label: 'Manager', type: 'RELATION', icon: 'IconUser',
      relationCreationPayload: { type: 'MANY_TO_ONE', targetObjectMetadataId: WORKSPACE_MEMBER_ID, targetFieldLabel: 'Company Account Assignments', targetFieldIcon: 'IconBriefcase' } },
    { name: 'assignedAt', label: 'Assigned At', type: 'DATE_TIME', icon: 'IconCalendarPlus', description: 'When this account owner became active.' },
    { name: 'endedAt', label: 'Ended At', type: 'DATE_TIME', icon: 'IconCalendarMinus', description: 'When this assignment was superseded (null = active).' },
  ];

  for (const f of fields) {
    if (existing.has(f.name)) { console.log(`• skip ${f.name}`); continue; }
    if (DRY) { console.log(`• would create field ${f.name} (${f.type})`); continue; }
    try {
      await createField({ objectMetadataId, isNullable: true, ...f });
      console.log(`✓ field ${f.name} (${f.type})`);
    } catch (e) {
      console.error(`✗ field ${f.name}: ${e.message}`);
      process.exitCode = 1;
    }
  }
  console.log('done.');
};

main().catch((e) => { console.error(e); process.exit(1); });
