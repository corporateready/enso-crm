#!/usr/bin/env node
// Idempotent provisioning of the two deal-comment objects:
//
//   dealComment         internal discussion on a deal (body + deal; the author
//                       is the createdBy actor)
//   dealCommentMention  one row per colleague a comment mentions. Carries the
//                       deal too, so record visibility can grant a mentioned
//                       manager that deal without joining through the comment.
//
// Both are written only by src/modules/enso/deal-comment (the generic record
// API is blocked for them), so no field here needs to be user-editable.
//
//   TWENTY_API_URL=https://crm.enso.ro TWENTY_API_KEY=<key> \
//     node packages/twenty-server/scripts/provision-deal-comments.mjs [--dry-run]
//
// Afterwards: add both objects to provision-sales-manager-role.mjs (already
// listed as OBSERVED) and re-run it, then REDEPLOY twenty-server and
// twenty-worker so their ORM metadata cache picks the objects up.

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
  const data = await gql(`query { objects(paging:{first:300}) { edges { node { id nameSingular } } } }`);
  return new Map(data.objects.edges.map((e) => [e.node.nameSingular, e.node.id]));
};

// Deliberately NOT the nested `fields` connection on `objects`: it silently
// truncates, so a field that exists would read as missing and be re-created.
const listFieldNames = async (objectMetadataId) => {
  const { fields } = await gql(
    `query($objectMetadataId: UUID!) {
      fields(paging: { first: 200 }, filter: { objectMetadataId: { eq: $objectMetadataId } }) {
        edges { node { name } }
      }
    }`,
    { objectMetadataId },
  );
  return new Set(fields.edges.map((e) => e.node.name));
};

const ensureObject = async (objectIds, object) => {
  const existingId = objectIds.get(object.nameSingular);
  if (existingId) {
    console.log(`• object exists: ${object.nameSingular} (${existingId})`);
    return existingId;
  }
  if (DRY) {
    console.log(`• would create object ${object.nameSingular}`);
    return undefined;
  }
  const data = await gql(
    `mutation($input: CreateOneObjectInput!){ createOneObject(input:$input){ id nameSingular } }`,
    { input: { object } },
  );
  const id = data.createOneObject.id;
  objectIds.set(object.nameSingular, id);
  console.log(`✓ object created: ${object.nameSingular} (${id})`);
  return id;
};

const ensureFields = async (objectMetadataId, nameSingular, fields) => {
  if (!objectMetadataId) {
    fields.forEach((f) => console.log(`• would create field ${nameSingular}.${f.name} (${f.type})`));
    return;
  }
  const existing = await listFieldNames(objectMetadataId);
  for (const f of fields) {
    if (existing.has(f.name)) { console.log(`• skip ${nameSingular}.${f.name}`); continue; }
    if (DRY) { console.log(`• would create field ${nameSingular}.${f.name} (${f.type})`); continue; }
    try {
      await gql(
        `mutation($input: CreateOneFieldMetadataInput!){ createOneField(input:$input){ id name } }`,
        { input: { field: { objectMetadataId, isNullable: true, ...f } } },
      );
      console.log(`✓ field ${nameSingular}.${f.name} (${f.type})`);
    } catch (e) {
      console.error(`✗ field ${nameSingular}.${f.name}: ${e.message}`);
      process.exitCode = 1;
    }
  }
};

const manyToOne = (name, label, icon, targetObjectMetadataId, targetFieldLabel, targetFieldIcon) => ({
  name,
  label,
  type: 'RELATION',
  icon,
  relationCreationPayload: { type: 'MANY_TO_ONE', targetObjectMetadataId, targetFieldLabel, targetFieldIcon },
});

const main = async () => {
  console.log(`Endpoint: ${ENDPOINT}${DRY ? ' (dry-run)' : ''}`);
  const objectIds = await listObjects();

  const opportunityId = objectIds.get('opportunity');
  const workspaceMemberId = objectIds.get('workspaceMember');
  if (!opportunityId || !workspaceMemberId) {
    throw new Error('opportunity or workspaceMember object not found');
  }

  const dealCommentId = await ensureObject(objectIds, {
    nameSingular: 'dealComment',
    namePlural: 'dealComments',
    labelSingular: 'Deal Comment',
    labelPlural: 'Deal Comments',
    icon: 'IconMessageCircle',
    description: 'Internal discussion on a deal. Every comment mentions at least one colleague.',
  });

  await ensureFields(dealCommentId, 'dealComment', [
    { name: 'body', label: 'Body', type: 'TEXT', icon: 'IconAlignLeft' },
    manyToOne('opportunity', 'Deal', 'IconTargetArrow', opportunityId, 'Deal Comments', 'IconMessageCircle'),
  ]);

  const mentionId = await ensureObject(objectIds, {
    nameSingular: 'dealCommentMention',
    namePlural: 'dealCommentMentions',
    labelSingular: 'Deal Comment Mention',
    labelPlural: 'Deal Comment Mentions',
    icon: 'IconAt',
    description: 'A colleague mentioned on a deal comment. Being mentioned lets them see that deal.',
  });

  await ensureFields(mentionId, 'dealCommentMention', [
    ...(dealCommentId
      ? [manyToOne('dealComment', 'Comment', 'IconMessageCircle', dealCommentId, 'Mentions', 'IconAt')]
      : [{ name: 'dealComment', type: 'RELATION' }]),
    manyToOne('opportunity', 'Deal', 'IconTargetArrow', opportunityId, 'Deal Comment Mentions', 'IconAt'),
    manyToOne('mentionedMember', 'Mentioned', 'IconUser', workspaceMemberId, 'Deal Comment Mentions', 'IconAt'),
  ]);

  console.log('done.');
};

main().catch((e) => { console.error(e); process.exit(1); });
