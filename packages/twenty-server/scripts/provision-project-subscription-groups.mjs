#!/usr/bin/env node
// Idempotent provisioning of the Project fields that carry each channel's
// Dittofeed subscription group id (see src/modules/enso/marketing-sync).
//
// Moves the CRM → Dittofeed consent mapping off a hardcoded constant and onto
// the Project record, so marketing can configure a new development in the CRM
// instead of waiting for a deploy.
//
// Talks to the running server's METADATA GraphQL API (/metadata) with a
// workspace API key — no DB access, safe against any environment, re-runnable.
//
// Usage:
//   TWENTY_API_URL=https://crm.enso.ro \
//   TWENTY_API_KEY=<workspace api key from Settings → APIs & Webhooks> \
//   node packages/twenty-server/scripts/provision-project-subscription-groups.mjs --dry-run
//
//   --dry-run            print what would change, write nothing
//   --channels=email,sms which channels to provision (default: email,sms —
//                        the two Dittofeed actually has subscription groups
//                        for; add whatsapp/call here if that ever changes, no
//                        code change needed)
//
// Set the ids themselves in the CRM, on each project. The one-time backfill of
// the two pilots is done, and carrying a hardcoded copy of their ids here would
// re-introduce exactly the second source of truth this whole change removed —
// worse, it would silently write stale ids if a group is ever recreated in
// Dittofeed.
//
// The field NAMES here must match SUBSCRIPTION_GROUP_FIELD_BY_CHANNEL in
// marketing-sync.constants.ts.

const API_URL = (process.env.TWENTY_API_URL ?? 'https://crm.enso.ro').replace(
  /\/$/,
  '',
);
const API_KEY = process.env.TWENTY_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');
const METADATA_ENDPOINT = `${API_URL}/metadata`;

const channelsArg = process.argv.find((arg) => arg.startsWith('--channels='));
const CHANNELS = (channelsArg ? channelsArg.split('=')[1] : 'email,sms')
  .split(',')
  .map((channel) => channel.trim())
  .filter(Boolean);

if (!API_KEY) {
  console.error('Missing TWENTY_API_KEY env var (workspace API key).');
  process.exit(1);
}

// Must stay in step with SUBSCRIPTION_GROUP_FIELD_BY_CHANNEL.
const FIELD_BY_CHANNEL = {
  email: 'dittofeedEmailSubscriptionGroupId',
  sms: 'dittofeedSmsSubscriptionGroupId',
  whatsapp: 'dittofeedWhatsappSubscriptionGroupId',
  call: 'dittofeedCallSubscriptionGroupId',
};

const LABEL_BY_CHANNEL = {
  email: 'Dittofeed Email Subscription Group',
  sms: 'Dittofeed SMS Subscription Group',
  whatsapp: 'Dittofeed WhatsApp Subscription Group',
  call: 'Dittofeed Call Subscription Group',
};

const unknownChannels = CHANNELS.filter(
  (channel) => !(channel in FIELD_BY_CHANNEL),
);

if (unknownChannels.length > 0) {
  console.error(
    `Unknown channel(s): ${unknownChannels.join(', ')}. Known: ${Object.keys(FIELD_BY_CHANNEL).join(', ')}`,
  );
  process.exit(1);
}

const gql = async (endpoint, query, variables) => {
  const response = await fetch(endpoint, {
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

const fetchProjectObjectId = async () => {
  const data = await gql(
    METADATA_ENDPOINT,
    `
    query Objects {
      objects(paging: { first: 200 }) {
        edges { node { id nameSingular } }
      }
    }
  `,
  );

  const project = data.objects.edges
    .map((edge) => edge.node)
    .find((node) => node.nameSingular === 'project');

  if (!project) {
    throw new Error('Could not find the "project" object in metadata.');
  }

  return project.id;
};

// Deliberately NOT the nested objects{fields{...}} connection: that one is
// paginated and silently truncates, so a field that exists can read as missing
// and this script would try to create a duplicate. Page the top-level field
// query for this object instead and decide from the full set.
const fetchExistingFieldNames = async (objectMetadataId) => {
  const names = new Set();
  let after = null;

  for (;;) {
    const data = await gql(
      METADATA_ENDPOINT,
      `
      query Fields($objectMetadataId: UUID!, $after: ConnectionCursor) {
        fields(
          paging: { first: 100, after: $after }
          filter: { objectMetadataId: { eq: $objectMetadataId } }
        ) {
          edges { node { name } cursor }
          pageInfo { hasNextPage endCursor }
        }
      }
    `,
      { objectMetadataId, after },
    );

    for (const edge of data.fields.edges) {
      names.add(edge.node.name);
    }

    if (!data.fields.pageInfo?.hasNextPage) {
      break;
    }

    after = data.fields.pageInfo.endCursor;
  }

  return names;
};

const createField = async (objectMetadataId, channel) =>
  gql(
    METADATA_ENDPOINT,
    `
    mutation CreateOneField($input: CreateOneFieldMetadataInput!) {
      createOneField(input: $input) { id name }
    }
  `,
    {
      input: {
        field: {
          objectMetadataId,
          name: FIELD_BY_CHANNEL[channel],
          label: LABEL_BY_CHANNEL[channel],
          type: 'TEXT',
          icon: 'IconBellRinging',
          description:
            `Dittofeed subscription group id scoping this development's ${channel} ` +
            `marketing. Empty = this project's ${channel} consent is not mirrored ` +
            `to Dittofeed.`,
          isNullable: true,
        },
      },
    },
  );

const main = async () => {
  console.log(
    `Metadata endpoint: ${METADATA_ENDPOINT}${DRY_RUN ? ' (dry-run)' : ''}`,
  );
  console.log(`Channels: ${CHANNELS.join(', ')}`);

  const objectMetadataId = await fetchProjectObjectId();

  console.log(`Project objectMetadataId: ${objectMetadataId}`);

  const existingFieldNames = await fetchExistingFieldNames(objectMetadataId);

  console.log(`Existing Project fields: ${existingFieldNames.size}`);

  let created = 0;
  let skipped = 0;

  for (const channel of CHANNELS) {
    const name = FIELD_BY_CHANNEL[channel];

    if (existingFieldNames.has(name)) {
      console.log(`• skip   ${name} (already exists)`);
      skipped += 1;
      continue;
    }

    if (DRY_RUN) {
      console.log(`• would create ${name} (TEXT)`);
      continue;
    }

    try {
      await createField(objectMetadataId, channel);
      console.log(`✓ create ${name} (TEXT)`);
      created += 1;
    } catch (error) {
      console.error(`✗ failed ${name}: ${error.message}`);
      process.exitCode = 1;
    }
  }

  console.log(
    `\nDone. created=${created} skipped=${skipped}${DRY_RUN ? ' (dry-run)' : ''}`,
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
