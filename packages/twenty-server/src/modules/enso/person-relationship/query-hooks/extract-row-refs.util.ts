import { isDefined } from 'twenty-shared/utils';

// Post-query hook payloads vary by operation: a single record (createOne /
// updateOne / deleteOne), an array, or a `{ records: [...] }` wrapper
// (createMany). We only need each row's `id` — the mirror service re-fetches
// the full row — so normalize to a list of `{ id }` refs.
export const extractRowRefs = (payload: unknown): { id: string }[] => {
  const candidates: unknown[] = Array.isArray(payload)
    ? payload
    : isDefined(payload) &&
        typeof payload === 'object' &&
        Array.isArray((payload as { records?: unknown[] }).records)
      ? ((payload as { records: unknown[] }).records ?? [])
      : [payload];

  return candidates
    .filter(
      (row): row is { id: string } =>
        isDefined(row) &&
        typeof row === 'object' &&
        typeof (row as { id?: unknown }).id === 'string',
    )
    .map((row) => ({ id: row.id }));
};
