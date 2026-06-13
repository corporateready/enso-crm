#!/usr/bin/env node
// Idempotent provisioning of the `marketingEnrollment` custom object — the
// CRM's record of a person's state in a Dittofeed marketing journey (one row
// per person × journey), written by the journey-callback endpoint. Powers the
// manager-facing journey-visibility widget. Talks to the running /metadata
// GraphQL API. See docs/marketing-engine-dittofeed.md.
//
//   TWENTY_API_URL=https://crm.enso.ro TWENTY_API_KEY=<key> \
//     node packages/twenty-server/scripts/provision-marketing-enrollment.mjs [--dry-run]
//
// After creating the object, REDEPLOY twenty-server (and twenty-worker) so the
// ORM metadata cache picks it up before any code writes to it.

const API_URL = (process.env.TWENTY_API_URL ?? 'https://crm.enso.ro').replace(/\/$/, '');
const API_KEY = process.env.TWENTY_API_KEY;
const DRY = process.argv.includes('--dry-run');
const ENDPOINT = `${API_URL}/metadata`;

if (!API_KEY) {
  console.error('Missing TWENTY_API_KEY');
  process.exit(1);
}

const INVERSE_LABEL = 'Marketing Enrollments';

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

const fetchObjects = async () => {
  const data = await gql(
    `query { objects(paging:{first:300}) { edges { node { id nameSingular fields(paging:{first:200}){edges{node{name}}} } } } }`,
  );
  return data.objects.edges.map((e) => e.node);
};

const createField = (field) =>
  gql(`mutation($input: CreateOneFieldMetadataInput!){ createOneField(input:$input){ id name } }`, { input: { field } });

const main = async () => {
  console.log(`Endpoint: ${ENDPOINT}${DRY ? ' (dry-run)' : ''}`);

  const nodes = await fetchObjects();
  const person = nodes.find((n) => n.nameSingular === 'person');
  const opportunity = nodes.find((n) => n.nameSingular === 'opportunity');

  if (!person || !opportunity) {
    throw new Error('Could not resolve the person / opportunity objects.');
  }

  let obj = nodes.find((n) => n.nameSingular === 'marketingEnrollment');

  if (!obj) {
    if (DRY) {
      console.log('• would create object marketingEnrollment');
    } else {
      const data = await gql(
        `mutation($input: CreateOneObjectInput!){ createOneObject(input:$input){ id nameSingular } }`,
        { input: { object: {
          nameSingular: 'marketingEnrollment',
          namePlural: 'marketingEnrollments',
          labelSingular: 'Marketing Enrollment',
          labelPlural: 'Marketing Enrollments',
          icon: 'IconMailForward',
          description: "A person's state in a Dittofeed marketing journey (one per person × journey).",
        } } },
      );
      obj = data.createOneObject;
      console.log(`✓ object created: ${obj.id}`);
    }
  } else {
    console.log(`• object exists: ${obj.id}`);
  }

  // In a dry run with no object yet, we can't create fields against it.
  if (!obj) {
    console.log('done (dry-run, object would be created first).');
    return;
  }

  const existing = new Set((obj.fields?.edges ?? []).map((e) => e.node.name));
  const objectMetadataId = obj.id;

  const fields = [
    { name: 'person', label: 'Person', type: 'RELATION', icon: 'IconUser',
      relationCreationPayload: { type: 'MANY_TO_ONE', targetObjectMetadataId: person.id, targetFieldLabel: INVERSE_LABEL, targetFieldIcon: 'IconMailForward' } },
    { name: 'sourceOpportunity', label: 'Source Opportunity', type: 'RELATION', icon: 'IconTargetArrow',
      description: 'The deal that triggered enrollment (deal-driven journeys), if any.',
      relationCreationPayload: { type: 'MANY_TO_ONE', targetObjectMetadataId: opportunity.id, targetFieldLabel: INVERSE_LABEL, targetFieldIcon: 'IconMailForward' } },
    { name: 'journey', label: 'Journey', type: 'TEXT', icon: 'IconRoute', description: 'Stable journey key, e.g. ARTIMA_INTRO.' },
    { name: 'status', label: 'Status', type: 'SELECT', icon: 'IconActivityHeartbeat',
      options: [
        { value: 'ACTIVE', label: 'Active', color: 'green', position: 0 },
        { value: 'FINISHED', label: 'Finished', color: 'blue', position: 1 },
        { value: 'EXITED', label: 'Exited', color: 'gray', position: 2 },
      ] },
    { name: 'currentStep', label: 'Current Step', type: 'TEXT', icon: 'IconStairs', description: 'Last milestone reached, e.g. email_2_sent.' },
    { name: 'enteredAt', label: 'Entered At', type: 'DATE_TIME', icon: 'IconCalendarPlus' },
    { name: 'lastEventAt', label: 'Last Event At', type: 'DATE_TIME', icon: 'IconCalendarTime' },
    { name: 'dittofeedJourneyId', label: 'Dittofeed Journey ID', type: 'TEXT', icon: 'IconHash', description: 'Correlates with the Dittofeed deliveries API.' },
    { name: 'nextExpectedAt', label: 'Next Expected At', type: 'DATE_TIME', icon: 'IconClockHour4', description: 'Phase 2: computed next send from the mirrored cadence.' },
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
