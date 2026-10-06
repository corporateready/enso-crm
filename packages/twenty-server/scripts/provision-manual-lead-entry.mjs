#!/usr/bin/env node
// Idempotent provisioning for manual lead entry (docs/manual-lead-entry.md).
//
// A lead a manager adds by hand enters the CRM like every other lead: as an
// inbound activity, so attribution, first-touch, timeline and deal resolution
// all run on it. This adds what that activity needs to say:
//
//   inboundActivity
//     kind  + MANUAL_ENTRY        a manager typed it in
//     source + MANUAL             no webhook carried it
//     isSelfReported              attribution was declared, not measured —
//                                 lets BI keep the two apart
//     enteredBy → workspaceMember who typed it in
//     manualLeadSource → …        the answer to "how did this lead reach you?"
//     referredByPerson / referredByCompany / referredByName
//                                 who referred it; the name is for referrers
//                                 who are not (or not visibly) in the CRM
//
//   manualLeadSource (new object) the list managers pick from, owned by
//                                 marketing. Each entry carries the tracking
//                                 values a lead from it gets, so managers never
//                                 type utm slugs and reports stay in
//                                 marketing's own taxonomy.
//
// Usage:
//   TWENTY_API_URL=https://crm.enso.ro TWENTY_API_KEY=<key> \
//     node packages/twenty-server/scripts/provision-manual-lead-entry.mjs [--dry-run] [--seed]
//
//   --seed adds starter sources (names, category, traffic type; utm left blank
//   for marketing) only when the list is empty.
//
// Re-running adds what is missing and never removes or renames anything.
// Afterwards: re-run provision-sales-manager-role.mjs (manualLeadSource is
// reference data there), then REDEPLOY twenty-server and twenty-worker so the
// ORM metadata cache picks up the new options and fields.

import { randomUUID } from 'node:crypto';

const API_URL = (process.env.TWENTY_API_URL ?? 'https://crm.enso.ro').replace(
  /\/$/,
  '',
);
const API_KEY = process.env.TWENTY_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');
const SEED = process.argv.includes('--seed');

if (!API_KEY) {
  console.error('Missing TWENTY_API_KEY env var (workspace API key).');
  process.exit(1);
}

const request = async (endpoint, query, variables) => {
  const response = await fetch(`${API_URL}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = await response.json();

  if (body.errors) {
    throw new Error(JSON.stringify(body.errors, null, 2));
  }

  return body.data;
};

const metadata = (query, variables) => request('metadata', query, variables);
const data = (query, variables) => request('graphql', query, variables);

const toOptions = (entries) =>
  entries.map(([value, label, color], position) => ({
    value,
    label,
    color,
    position,
  }));

const TRAFFIC_TYPE_OPTIONS = toOptions([
  ['PAID', 'Paid', 'red'],
  ['ORGANIC', 'Organic', 'green'],
  ['DIRECT', 'Direct', 'blue'],
  ['SOCIAL', 'Social', 'purple'],
  ['EMAIL', 'Email', 'turquoise'],
  ['REFERRAL', 'Referral', 'orange'],
  ['OTHER', 'Other', 'gray'],
]);

const MANUAL_LEAD_SOURCE_OBJECT = {
  nameSingular: 'manualLeadSource',
  namePlural: 'manualLeadSources',
  labelSingular: 'Manual Lead Source',
  labelPlural: 'Manual Lead Sources',
  description:
    'Where a lead a manager adds by hand came from. Maintained by marketing; each entry sets the tracking values its leads get.',
  icon: 'IconSignRight',
};

// Category drives behaviour in code: REFERRAL asks who referred the lead, and
// REFERRAL / WALK_IN become the deal source of the same name (the rest MANUAL).
const MANUAL_LEAD_SOURCE_FIELDS = (projectObjectId) => [
  {
    name: 'category',
    label: 'Category',
    type: 'SELECT',
    icon: 'IconCategory',
    description: 'What kind of source this is.',
    options: toOptions([
      ['REFERRAL', 'Referral', 'orange'],
      ['WALK_IN', 'Walk-in', 'blue'],
      ['EVENT', 'Event', 'purple'],
      ['OWN_NETWORK', 'Own network', 'green'],
      ['DIRECT_CONTACT', 'Contacted a manager directly', 'turquoise'],
      ['AD_OR_WEBSITE', 'Saw an ad or the website', 'red'],
      ['OTHER', 'Other', 'gray'],
    ]),
  },
  {
    name: 'trafficType',
    label: 'Traffic Type',
    type: 'SELECT',
    icon: 'IconRoute',
    description: 'Traffic type its leads are recorded with.',
    options: TRAFFIC_TYPE_OPTIONS,
  },
  {
    name: 'utmSource',
    label: 'UTM Source',
    type: 'TEXT',
    icon: 'IconTag',
    description: "utm_source its leads get, in marketing's slug taxonomy.",
  },
  {
    name: 'utmMedium',
    label: 'UTM Medium',
    type: 'TEXT',
    icon: 'IconTag',
    description: "utm_medium its leads get, in marketing's slug taxonomy.",
  },
  {
    name: 'utmCampaign',
    label: 'UTM Campaign',
    type: 'TEXT',
    icon: 'IconTag',
    description:
      "utm_campaign its leads get, e.g. the event's campaign slug. Blank for evergreen sources.",
  },
  {
    name: 'isActive',
    label: 'Active',
    type: 'BOOLEAN',
    icon: 'IconToggleRight',
    description: 'Only active sources are offered to managers.',
    defaultValue: true,
  },
  manyToOne(
    'project',
    'Project',
    'IconBuildingCommunity',
    projectObjectId,
    'Manual Lead Sources',
    'IconSignRight',
    'Only offered for leads of this project. Blank = every project.',
  ),
];

const INBOUND_ACTIVITY_OPTION_ADDITIONS = {
  kind: toOptions([['MANUAL_ENTRY', 'Manual entry', 'gray']]),
  source: toOptions([['MANUAL', 'Manual', 'gray']]),
};

const INBOUND_ACTIVITY_FIELDS = (objectIds) => [
  {
    name: 'isSelfReported',
    label: 'Self-reported',
    type: 'BOOLEAN',
    icon: 'IconUserQuestion',
    description:
      'Attribution was declared by a manager, not measured by a tracking system.',
    defaultValue: false,
  },
  {
    name: 'referredByName',
    label: 'Referred By (name)',
    type: 'TEXT',
    icon: 'IconUserShare',
    description:
      'Who referred the lead, when they are not a contact in the CRM.',
  },
  manyToOne(
    'enteredBy',
    'Entered By',
    'IconUserEdit',
    objectIds.get('workspaceMember'),
    'Manually Entered Leads',
    'IconUserPlus',
    'The manager who added this lead by hand.',
  ),
  manyToOne(
    'referredByPerson',
    'Referred By',
    'IconUserShare',
    objectIds.get('person'),
    'Referred Leads',
    'IconUserShare',
    'The contact who referred this lead.',
  ),
  manyToOne(
    'referredByCompany',
    'Referred By Company',
    'IconBuildingSkyscraper',
    objectIds.get('company'),
    'Referred Leads',
    'IconUserShare',
    'The company that referred this lead.',
  ),
  manyToOne(
    'manualLeadSource',
    'Manual Lead Source',
    'IconSignRight',
    objectIds.get(MANUAL_LEAD_SOURCE_OBJECT.nameSingular),
    'Leads',
    'IconInbox',
    'How a manually added lead reached the manager.',
  ),
];

const SEED_SOURCES = [
  { name: 'Referral', category: 'REFERRAL', trafficType: 'REFERRAL' },
  { name: 'Walk-in', category: 'WALK_IN', trafficType: 'DIRECT' },
  { name: 'Own network', category: 'OWN_NETWORK', trafficType: 'DIRECT' },
  {
    name: 'Contacted me directly',
    category: 'DIRECT_CONTACT',
    trafficType: 'DIRECT',
  },
  { name: 'Saw an ad', category: 'AD_OR_WEBSITE', trafficType: 'PAID' },
  {
    name: 'Found the website or social page',
    category: 'AD_OR_WEBSITE',
    trafficType: 'ORGANIC',
  },
];

function manyToOne(
  name,
  label,
  icon,
  targetObjectMetadataId,
  targetFieldLabel,
  targetFieldIcon,
  description,
) {
  return {
    name,
    label,
    type: 'RELATION',
    icon,
    description,
    relationCreationPayload: {
      type: 'MANY_TO_ONE',
      targetObjectMetadataId,
      targetFieldLabel,
      targetFieldIcon,
    },
  };
}

const listObjectIds = async () => {
  const { objects } = await metadata(
    `query { objects(paging: { first: 500 }) {
      edges { node { id nameSingular } }
    } }`,
  );

  return new Map(
    objects.edges.map((edge) => [edge.node.nameSingular, edge.node.id]),
  );
};

// Deliberately NOT the nested `fields` connection on `objects`: it silently
// truncates, so a field that exists would read as missing and be re-created.
const listFields = async (objectMetadataId) => {
  const { fields } = await metadata(
    `query FieldsForObject($objectMetadataId: UUID!) {
      fields(
        paging: { first: 300 }
        filter: { objectMetadataId: { eq: $objectMetadataId } }
      ) {
        edges { node { id name type options } }
      }
    }`,
    { objectMetadataId },
  );

  return new Map(fields.edges.map((edge) => [edge.node.name, edge.node]));
};

const ensureObject = async (objectIds, object) => {
  const existingId = objectIds.get(object.nameSingular);

  if (existingId) {
    console.log(`• object exists: ${object.nameSingular} (${existingId})`);

    return existingId;
  }

  if (DRY_RUN) {
    console.log(`+ would create object ${object.nameSingular}`);

    return undefined;
  }

  const { createOneObject } = await metadata(
    `mutation CreateObject($input: CreateOneObjectInput!) {
      createOneObject(input: $input) { id }
    }`,
    { input: { object } },
  );

  objectIds.set(object.nameSingular, createOneObject.id);
  console.log(
    `✓ created object ${object.nameSingular} (${createOneObject.id})`,
  );

  return createOneObject.id;
};

const ensureFields = async (objectMetadataId, objectName, fields) => {
  const existing = isDefinedId(objectMetadataId)
    ? await listFields(objectMetadataId)
    : new Map();

  for (const field of fields) {
    if (existing.has(field.name)) {
      console.log(`• skip ${objectName}.${field.name}`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`+ would create ${objectName}.${field.name} (${field.type})`);
      continue;
    }

    if (
      field.type === 'RELATION' &&
      !field.relationCreationPayload.targetObjectMetadataId
    ) {
      throw new Error(`${objectName}.${field.name}: target object not found`);
    }

    await metadata(
      `mutation CreateOneField($input: CreateOneFieldMetadataInput!) {
        createOneField(input: $input) { id name }
      }`,
      { input: { field: { objectMetadataId, isNullable: true, ...field } } },
    );
    console.log(`✓ created ${objectName}.${field.name} (${field.type})`);
  }
};

// An update REPLACES the whole option list, so every live option is sent back
// with its own id, label and colour; dropping one would orphan the rows that
// hold it. New options are appended at the end.
const addMissingOptions = async (field, additions) => {
  const current = field.options ?? [];
  const liveValues = new Set(current.map((option) => option.value));
  const missing = additions.filter((option) => !liveValues.has(option.value));

  if (missing.length === 0) {
    console.log(`• options present on inboundActivity.${field.name}`);

    return;
  }

  const added = missing.map((option) => option.value).join(', ');

  if (DRY_RUN) {
    console.log(
      `+ would add option(s) to inboundActivity.${field.name}: ${added}`,
    );

    return;
  }

  const nextOptions = [
    ...current.map(({ id, value, label, color }) => ({
      id,
      value,
      label,
      color,
    })),
    ...missing.map(({ value, label, color }) => ({
      id: randomUUID(),
      value,
      label,
      color,
    })),
  ].map((option, position) => ({ ...option, position }));

  await metadata(
    `mutation UpdateOneField($input: UpdateOneFieldMetadataInput!) {
      updateOneField(input: $input) { id }
    }`,
    { input: { id: field.id, update: { options: nextOptions } } },
  );
  console.log(`✓ added option(s) to inboundActivity.${field.name}: ${added}`);
};

const seedSources = async (objectMetadataId) => {
  if (!SEED) {
    return;
  }

  if (!isDefinedId(objectMetadataId)) {
    console.log(`+ would seed ${SEED_SOURCES.length} starter source(s)`);

    return;
  }

  const { manualLeadSources } = await data(
    `query { manualLeadSources(first: 1) { totalCount } }`,
  );

  if (manualLeadSources.totalCount > 0) {
    console.log(
      `• skip seeding: ${manualLeadSources.totalCount} source(s) already exist`,
    );

    return;
  }

  if (DRY_RUN) {
    console.log(`+ would seed ${SEED_SOURCES.length} starter source(s)`);

    return;
  }

  await data(
    `mutation Seed($data: [ManualLeadSourceCreateInput!]!) {
      createManualLeadSources(data: $data) { id }
    }`,
    { data: SEED_SOURCES.map((source) => ({ ...source, isActive: true })) },
  );
  console.log(`✓ seeded ${SEED_SOURCES.length} starter source(s)`);
};

function isDefinedId(id) {
  return typeof id === 'string' && id.length > 0;
}

const main = async () => {
  console.log(`Endpoint: ${API_URL}${DRY_RUN ? ' (dry-run)' : ''}`);

  const objectIds = await listObjectIds();

  for (const name of [
    'inboundActivity',
    'person',
    'company',
    'project',
    'workspaceMember',
  ]) {
    if (!objectIds.has(name)) {
      throw new Error(`object ${name} not found`);
    }
  }

  const sourceObjectId = await ensureObject(
    objectIds,
    MANUAL_LEAD_SOURCE_OBJECT,
  );

  await ensureFields(
    sourceObjectId,
    MANUAL_LEAD_SOURCE_OBJECT.nameSingular,
    MANUAL_LEAD_SOURCE_FIELDS(objectIds.get('project')),
  );

  const inboundActivityId = objectIds.get('inboundActivity');
  const inboundActivityFields = await listFields(inboundActivityId);

  for (const [fieldName, additions] of Object.entries(
    INBOUND_ACTIVITY_OPTION_ADDITIONS,
  )) {
    const field = inboundActivityFields.get(fieldName);

    if (!field) {
      throw new Error(`inboundActivity.${fieldName} not found`);
    }

    await addMissingOptions(field, additions);
  }

  await ensureFields(
    inboundActivityId,
    'inboundActivity',
    INBOUND_ACTIVITY_FIELDS(objectIds),
  );

  await seedSources(sourceObjectId);

  console.log(DRY_RUN ? '\n--dry-run: nothing written.' : '\nDone.');

  if (!DRY_RUN) {
    console.log(
      'Next: re-run provision-sales-manager-role.mjs, then redeploy twenty-server and twenty-worker.',
    );
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
