#!/usr/bin/env node
// Idempotent provisioning of the OBSERVED option on outboundActivity.loggedVia.
//
// Why a fourth option. The three existing values all describe a touch a manager
// *told us about*: CRM_INITIATED (they pressed a button here), MANUAL_LOG (they
// did it elsewhere and typed it in), CORPORATE_GSM (a recording SIM). A call
// placed through the PBX from the Moldcell app, a desk phone or a softphone is
// none of those: nobody logged it, and yet we have the duration, the recording
// and the manager. That is OBSERVED — captured by our infrastructure without a
// human action in the CRM. See src/modules/enso/telephony/services/
// outbound-call-ingest.service.ts.
//
//   TWENTY_API_URL=https://crm.enso.ro TWENTY_API_KEY=<key> \
//     node packages/twenty-server/scripts/provision-outbound-activity-observed.mjs [--dry-run]
//
// NOTE: after this runs, REDEPLOY twenty-worker so its ORM metadata cache picks
// up the new option (otherwise writes of `OBSERVED` are rejected/dropped).

import { randomUUID } from 'node:crypto';

const API_URL = (process.env.TWENTY_API_URL ?? 'https://crm.enso.ro').replace(
  /\/$/,
  '',
);
const API_KEY = process.env.TWENTY_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');
const ENDPOINT = `${API_URL}/metadata`;

if (!API_KEY) {
  console.error('Missing TWENTY_API_KEY');
  process.exit(1);
}

const OBJECT_NAME = 'outboundActivity';
const FIELD_NAME = 'loggedVia';
const NEW_OPTION = {
  // Field-metadata options carry their own stable id; new ones must be minted.
  id: randomUUID(),
  value: 'OBSERVED',
  label: 'Observed',
  color: 'turquoise',
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

  const objects = await gql(`
    query {
      objects(paging: { first: 300 }) {
        edges { node { id nameSingular } }
      }
    }
  `);

  const object = objects.objects.edges
    .map((edge) => edge.node)
    .find((node) => node.nameSingular === OBJECT_NAME);

  if (!object) {
    throw new Error(`Could not find the "${OBJECT_NAME}" object.`);
  }

  const fields = await gql(
    `query ($id: UUID!) {
       fields(paging: { first: 300 }, filter: { objectMetadataId: { eq: $id } }) {
         edges { node { id name type options } }
       }
     }`,
    { id: object.id },
  );

  const field = fields.fields.edges
    .map((edge) => edge.node)
    .find((node) => node.name === FIELD_NAME);

  if (!field) {
    throw new Error(`Could not find ${OBJECT_NAME}.${FIELD_NAME}.`);
  }

  const options = field.options ?? [];

  if (options.some((option) => option.value === NEW_OPTION.value)) {
    console.log(`• skip ${NEW_OPTION.value} (already an option)`);

    return;
  }

  // A SELECT update REPLACES the option list, so the existing options have to be
  // sent back verbatim — dropping one would orphan every row that uses it.
  const nextOptions = [
    ...options.map((option) => ({
      id: option.id,
      value: option.value,
      label: option.label,
      color: option.color,
      position: option.position,
    })),
    { ...NEW_OPTION, position: options.length },
  ];

  if (DRY_RUN) {
    console.log(
      `• would set options to: ${nextOptions.map((o) => o.value).join(', ')}`,
    );

    return;
  }

  await gql(
    `mutation UpdateOneField($input: UpdateOneFieldMetadataInput!) {
       updateOneField(input: $input) { id name options }
     }`,
    {
      input: {
        id: field.id,
        update: { options: nextOptions },
      },
    },
  );

  console.log(`✓ added ${NEW_OPTION.value} to ${OBJECT_NAME}.${FIELD_NAME}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
