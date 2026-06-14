// Adds the per-manager corporate-GSM capability + the CORPORATE_GSM loggedVia value.
// (1) workspaceMember.hasRecordingGsm BOOLEAN custom field (gates the on-system
//     "Call from corporate GSM" action), (2) outboundActivity.loggedVia +CORPORATE_GSM.
// Idempotent-ish: re-running the field create will error if it exists (safe to ignore).
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync(new URL('./.env', `file://${process.cwd()}/`), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]),
);
const KEY = env.TWENTY_API_KEY;
const BASE = env.TWENTY_BASE_URL;

async function meta(query, variables) {
  const r = await fetch(`${BASE}/metadata`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

const WORKSPACE_MEMBER_OBJECT_ID = 'b3c22c83-033d-4c0c-a312-8fcfedba7e55';
const LOGGED_VIA_FIELD_ID = 'd9a989c7-80da-4980-8cf5-81f939c6768c';

// (1) per-manager capability flag
try {
  await meta(
    `mutation C($input: CreateOneFieldMetadataInput!) { createOneField(input: $input) { id name } }`,
    {
      input: {
        name: 'hasRecordingGsm',
        label: 'Has recording GSM',
        description:
          'Manager has a corporate GSM / recording SIM that captures calls both ways. Gates the on-system "Call from corporate GSM" action.',
        type: 'BOOLEAN',
        icon: 'IconDeviceMobile',
        objectMetadataId: WORKSPACE_MEMBER_OBJECT_ID,
        defaultValue: false,
      },
    },
  );
  console.log('created workspaceMember.hasRecordingGsm');
} catch (error) {
  console.log('hasRecordingGsm create skipped:', error.message.slice(0, 120));
}

// (2) loggedVia += CORPORATE_GSM (keep existing options verbatim)
const loggedViaOptions = [
  { id: '58dca6b1-97b3-4561-bee6-2e2e2f6d46bf', color: 'green', label: 'CRM initiated', value: 'CRM_INITIATED', position: 0 },
  { id: '5319d3ed-de21-4499-ae6c-0a6ba6d53a65', color: 'gray', label: 'Manual log', value: 'MANUAL_LOG', position: 1 },
  { id: randomUUID(), color: 'turquoise', label: 'Corporate GSM', value: 'CORPORATE_GSM', position: 2 },
];
await meta(
  `mutation U($input: UpdateOneFieldMetadataInput!) { updateOneField(input: $input) { id } }`,
  { input: { id: LOGGED_VIA_FIELD_ID, update: { options: loggedViaOptions } } },
);
console.log('loggedVia += CORPORATE_GSM');
