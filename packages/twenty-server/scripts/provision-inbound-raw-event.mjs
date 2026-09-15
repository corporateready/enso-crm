#!/usr/bin/env node
// Idempotent provisioning of the `inboundRawEvent` object — the raw intake log.
//
// WHY THIS EXISTS
//
// Every inbound webhook the CRM owns is currently acknowledged with 200 and
// then normalized. A push that fails to normalize, or carries an unrecognised
// `cmd`, is acked and vanishes: no record, nothing to replay, and no way to
// notice. That is the same class of failure as the calls pipeline that was
// severed at one node and silently dropped every call.
//
// So the payload is written down FIRST, before anything interprets it, and the
// outcome is stamped on it afterwards. That gives three things: nothing that
// reached us is lost, a failed batch can be replayed, and reconciliation gets a
// denominator that is independent of whether the CRM's own logic worked.
//
// A custom object rather than a core table on purpose: no schema migration, and
// the workspace schema is already replicated wholesale into BigQuery by dlt, so
// the log arrives in the warehouse with no ingestion work.
//
// Usage:
//   TWENTY_API_URL=https://crm.enso.ro \
//   TWENTY_API_KEY=<workspace api key> \
//   node packages/twenty-server/scripts/provision-inbound-raw-event.mjs
//
//   Add --dry-run to print the plan without writing.
//
// The field NAMES here must match what EnsoInboundRawEventService writes, and
// so must the SELECT option VALUES — a write of an option the field does not
// have is rejected. Re-running this adds options that were introduced after the
// object was first provisioned; it never removes or renames an existing one,
// because that would orphan the rows already carrying it.
//
// NOTE: after this adds an option, REDEPLOY twenty-server (and twenty-worker if
// it writes the object) so the ORM metadata cache picks it up.

import { randomUUID } from 'node:crypto';

const API_URL = (process.env.TWENTY_API_URL ?? 'https://crm.enso.ro').replace(
  /\/$/,
  '',
);
const API_KEY = process.env.TWENTY_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');
const METADATA_ENDPOINT = `${API_URL}/metadata`;

if (!API_KEY) {
  console.error('Missing TWENTY_API_KEY env var (workspace API key).');
  process.exit(1);
}

const OBJECT = {
  nameSingular: 'inboundRawEvent',
  namePlural: 'inboundRawEvents',
  labelSingular: 'Inbound Raw Event',
  labelPlural: 'Inbound Raw Events',
  description:
    'Every inbound webhook payload, written before it is interpreted. Operational log for replay and reconciliation.',
  icon: 'IconInbox',
};

const toOptions = (entries) =>
  entries.map(([value, label, color], index) => ({
    value,
    label,
    color,
    position: index,
  }));

const FIELDS = [
  {
    name: 'channel',
    label: 'Channel',
    type: 'SELECT',
    icon: 'IconRoute',
    description: 'Which intake path this payload arrived on.',
    options: toOptions([
      ['PBX', 'PBX', 'blue'],
      ['ROISTAT', 'Roistat', 'purple'],
      ['CHATWOOT', 'Chatwoot', 'green'],
      ['META_LEADGEN', 'Meta Lead Ads', 'sky'],
      ['FORM', 'Website Form', 'turquoise'],
      ['OTHER', 'Other', 'gray'],
    ]),
  },
  {
    name: 'source',
    label: 'Source',
    type: 'TEXT',
    icon: 'IconTag',
    description:
      'Finer-grained origin within the channel, e.g. moldcell:event, moldcell:history, roistat:webhook_start.',
  },
  {
    name: 'externalId',
    label: 'External ID',
    type: 'TEXT',
    icon: 'IconHash',
    description:
      "The source system's own id — PBX call id, Chatwoot conversation id, Meta leadgen id. This is the join key reconciliation uses.",
  },
  {
    name: 'occurredAt',
    label: 'Occurred At',
    type: 'DATE_TIME',
    icon: 'IconClock',
    description:
      'Event time as reported by the source, when the payload carries one. Compared against creation date to measure intake lag.',
  },
  {
    name: 'payload',
    label: 'Payload',
    type: 'RAW_JSON',
    icon: 'IconCode',
    description: 'The body exactly as received, before any interpretation.',
  },
  {
    name: 'processingStatus',
    label: 'Processing Status',
    type: 'SELECT',
    icon: 'IconCircleDot',
    description:
      'What became of this payload. IGNORED and FAILED are the rows that used to disappear without trace; RECEIVED is a row whose outcome never landed, which is itself a fault worth chasing.',
    options: toOptions([
      ['RECEIVED', 'Received', 'gray'],
      // Logged on a path that never stamps an outcome — today only the PBX
      // `contact` push, which must answer a ringing call and cannot wait for a
      // second round trip. Distinct from RECEIVED on purpose: without it the
      // busiest source in the log would sit at RECEIVED forever and bury the
      // rows that are stuck for a real reason.
      ['NOT_TRACKED', 'Not tracked', 'gray'],
      ['ENQUEUED', 'Enqueued', 'blue'],
      ['IGNORED', 'Ignored', 'orange'],
      ['FAILED', 'Failed', 'red'],
    ]),
  },
  {
    name: 'processingNote',
    label: 'Processing Note',
    type: 'TEXT',
    icon: 'IconAlertTriangle',
    description:
      'Why a payload was ignored or failed — the reason it would otherwise have vanished with.',
  },
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

  const body = await response.json();

  if (body.errors) {
    throw new Error(JSON.stringify(body.errors, null, 2));
  }

  return body.data;
};

const findObject = async () => {
  const { objects } = await gql(
    `query { objects(paging: { first: 500 }) {
      edges { node { id nameSingular isActive } }
    } }`,
  );

  return objects.edges
    .map((edge) => edge.node)
    .find((node) => node.nameSingular === OBJECT.nameSingular);
};

// Deliberately NOT the nested `fields` connection on `objects`: that connection
// silently truncates, so it reports fields as absent that plainly exist, and
// this script would then try to re-create them on every run. Ask the top-level
// `fields` query for one object instead.
const findFields = async (objectMetadataId) => {
  const { fields } = await gql(
    `query FieldsForObject($objectMetadataId: UUID!) {
      fields(
        paging: { first: 200 }
        filter: { objectMetadataId: { eq: $objectMetadataId } }
      ) {
        edges { node { id name type options } }
      }
    }`,
    { objectMetadataId },
  );

  return fields.edges.map((edge) => edge.node);
};

// Adds SELECT options that were introduced after the field was created. An
// update REPLACES the whole option list, so every existing option is sent back
// with its own id — drop one and every row already holding that value is
// orphaned. An existing option keeps its label and colour too, so a tweak made
// in the UI survives a re-run; only the order is rewritten, to the order
// declared above.
const addMissingOptions = async (field, expected) => {
  const current = field.options ?? [];
  const liveByValue = new Map(current.map((option) => [option.value, option]));
  const missing = expected.filter((option) => !liveByValue.has(option.value));

  if (missing.length === 0) {
    return;
  }

  const expectedValues = new Set(expected.map((option) => option.value));

  const nextOptions = [
    ...expected.map((option) => {
      const live = liveByValue.get(option.value);

      return live
        ? {
            id: live.id,
            value: live.value,
            label: live.label,
            color: live.color,
          }
        : {
            // Options carry their own stable id; a new one has to be minted.
            id: randomUUID(),
            value: option.value,
            label: option.label,
            color: option.color,
          };
    }),
    // An option this script no longer declares is still kept: rows may be using
    // it, and removing values is not this script's job.
    ...current
      .filter((option) => !expectedValues.has(option.value))
      .map((option) => ({
        id: option.id,
        value: option.value,
        label: option.label,
        color: option.color,
      })),
  ].map((option, position) => ({ ...option, position }));

  const added = missing.map((option) => option.value).join(', ');

  if (DRY_RUN) {
    console.log(`  would add option(s) to ${field.name}: ${added}`);

    return;
  }

  await gql(
    `mutation UpdateOneField($input: UpdateOneFieldMetadataInput!) {
      updateOneField(input: $input) { id name }
    }`,
    { input: { id: field.id, update: { options: nextOptions } } },
  );

  console.log(`  added option(s) to ${field.name}: ${added}`);
};

const main = async () => {
  console.log(
    `Metadata endpoint: ${METADATA_ENDPOINT}${DRY_RUN ? ' (dry-run)' : ''}`,
  );

  let object = await findObject();

  if (!object) {
    console.log(
      `Object "${OBJECT.nameSingular}" does not exist — will create.`,
    );

    if (!DRY_RUN) {
      const { createOneObject } = await gql(
        `mutation CreateObject($input: CreateOneObjectInput!) {
          createOneObject(input: $input) { id nameSingular }
        }`,
        { input: { object: OBJECT } },
      );
      console.log(`  created object ${createOneObject.id}`);
      object = await findObject();
    }
  } else {
    console.log(`Object "${OBJECT.nameSingular}" exists (${object.id}).`);
  }

  if (DRY_RUN && !object) {
    console.log(
      `\n--dry-run: would create the object and ${FIELDS.length} field(s):`,
    );
    for (const field of FIELDS) {
      console.log(`  - ${field.name} (${field.type})`);
    }

    return;
  }

  const existing = await findFields(object.id);
  const existingByName = new Map(existing.map((field) => [field.name, field]));
  const missing = FIELDS.filter((field) => !existingByName.has(field.name));

  console.log(
    `${FIELDS.length} expected field(s): ${FIELDS.length - missing.length} present, ${missing.length} to create`,
  );

  // A field that already exists still needs reconciling: a SELECT that gained a
  // value in the code rejects writes of it until the option exists here too.
  for (const field of FIELDS) {
    const live = existingByName.get(field.name);

    if (live && field.options) {
      await addMissingOptions(live, field.options);
    }
  }

  if (DRY_RUN) {
    for (const field of missing) {
      console.log(`  would create ${field.name} (${field.type})`);
    }
    console.log('\n--dry-run: nothing written.');

    return;
  }

  for (const field of missing) {
    await gql(
      `mutation CreateOneField($input: CreateOneFieldMetadataInput!) {
        createOneField(input: $input) { id name }
      }`,
      {
        input: {
          field: {
            objectMetadataId: object.id,
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
    console.log(`  created ${field.name}`);
  }

  console.log('\nDone.');
  console.log(
    'Next: redeploy twenty-server if an option was added (the ORM caches metadata),',
  );
  console.log(
    're-run provision-sales-manager-role.mjs so the role cannot read it,',
  );
  console.log(
    'and add inboundRawEvent to the dlt curated slice if reconciliation needs it sooner than the next full sync.',
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
