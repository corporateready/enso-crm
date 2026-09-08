import { isDefined } from 'twenty-shared/utils';

// The one transformation the raw intake log is allowed to make.
//
// The log's promise is "the body exactly as received", and that promise is what
// makes it usable for replay and reconciliation. But some senders put their
// shared secret INSIDE the body: the Moldcell PBX authenticates every push with
// `crm_token`, so writing the body verbatim stored the live PBX credential in a
// CRM record — on every row, forever, and replicated wholesale into BigQuery by
// dlt. Object permissions do not help: they stop a sales manager, not an admin
// or a warehouse reader.
//
// So credential-shaped KEYS have their values replaced, and nothing else is
// touched. Structure, ordering, types and every other value stay byte-for-byte,
// which keeps the log replayable — a replay re-authenticates from config, it
// never needs the secret that arrived in the payload.
const SECRET_KEY_PATTERN =
  /(^|[_-])(crm_token|token|secret|password|passwd|api[_-]?key|apikey|authorization|auth|signature|sig|credential)([_-]|$)/i;

export const REDACTED_PLACEHOLDER = '[redacted]';
export const TRUNCATED_PLACEHOLDER = '[truncated: too deeply nested to scan]';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && isDefined(value) && !Array.isArray(value);

// Depth is bounded because a webhook body is attacker-adjacent input: a deeply
// nested or self-referential structure must not turn logging into a stack
// overflow on a live-call path. Well past anything a real sender produces —
// Meta's nested lead payloads are ~5 deep.
const MAX_DEPTH = 32;

export const redactPayloadSecrets = (payload: unknown, depth = 0): unknown => {
  // Fail safe, not open: returning the value here would hand back a subtree
  // that was never scanned, so a secret nested past the bound would be stored.
  if (depth >= MAX_DEPTH) {
    return isPlainObject(payload) || Array.isArray(payload)
      ? TRUNCATED_PLACEHOLDER
      : payload;
  }

  if (Array.isArray(payload)) {
    return payload.map((entry) => redactPayloadSecrets(entry, depth + 1));
  }

  if (!isPlainObject(payload)) {
    return payload;
  }

  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [
      key,
      SECRET_KEY_PATTERN.test(key)
        ? REDACTED_PLACEHOLDER
        : redactPayloadSecrets(value, depth + 1),
    ]),
  );
};
