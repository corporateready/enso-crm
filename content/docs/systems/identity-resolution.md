---
title: Identity resolution
description: Phone-keyed deduplication of People at intake and asynchronously.
---

# Identity resolution

## The primary key — E.164 phone

70% of inbound has phone, not always email. All four intake channels (call, form, social, lead ad) carry phone reliably. Phone (E.164) is the identity key.

## Normalization

At intake, every phone is run through libphonenumber:

```ts
import { parsePhoneNumber } from 'libphonenumber-js'

function normalizePhone(raw: string, callContext?: { didCountry?: 'RO' | 'MD' }): string | null {
  const defaultRegion = callContext?.didCountry ?? 'MD'  // most calls are Moldcell
  const parsed = parsePhoneNumber(raw, defaultRegion)
  return parsed?.isValid() ? parsed.number : null  // E.164: '+37368012345'
}
```

Rules:
- Default region by **DID country** of the call (RO=`+40`, MD=`+373`). For non-call channels, fall back to user-supplied country or `MD`.
- If parse fails → null. Activity still ingests with `null` phone but won't dedup; manual reconciliation queue.
- Store as E.164 column `phone_e164` with `UNIQUE` constraint.

## Resolution at intake — synchronous

```text
function resolvePersonAtIntake(phoneE164, email, fullName):
    // 1. Phone match (primary)
    if phoneE164:
        person = SELECT * FROM people WHERE phone_e164 = phoneE164
        if person: return person

    // 2. Email match (fallback)
    if email:
        person = SELECT * FROM people WHERE email_normalized = lower(email)
        if person: return person

    // 3. Phone in alt array (rare)
    if phoneE164:
        person = SELECT * FROM people WHERE phoneE164 = ANY(phone_alt)
        if person: return person

    // 4. No match — create
    return INSERT INTO people (phone_e164, email_normalized, name_display, ...)
```

This is what today's `Forms/Calls/Social Workflow` does inline before insert. The Postgres `UNIQUE` constraints make it race-safe (concurrent intakes can't create dup keys).

## Async merge — the conflict case

When a new phone gets added to a Person record (manager edits, social profile claims another number), it may now match another existing Person. That's the trigger for the async merge job — replaces today's `Merging Contacts` n8n workflow (14 nodes).

```ts
async function mergePersonIfDuplicate(personId, newPhone) {
  const conflict = await db.query(
    `SELECT * FROM people WHERE phone_e164 = $1 AND id != $2`,
    [newPhone, personId]
  )
  if (!conflict.length) return

  const [main, secondary] = orderByCreated(conflict[0], await getPerson(personId))
  // main = older; secondary = newer (gets soft-deleted)
  await mergePerson(main, secondary)
}
```

### Merge rules (per-field)

Same as the `Merging Contacts` n8n logic, cleaned up:

| Field type | Rule |
|---|---|
| Scalar (name, email, language, country) | Keep `main`'s value if non-null, else `secondary`'s |
| Multi-value arrays (`phone_alt`, `email_alt`) | Union sets |
| Project interests (`person_projects`) | Union (m:n table) |
| Activities | Re-point `person_id` to `main` |
| Interactions | Re-point `person_id` to `main` |
| Deals | Re-point `associated_people` to `main` |
| Tasks | Re-point `person_id` to `main` (via deal) |
| Read-only fields (`created_at`, audit) | Untouched |
| Notes | Concatenate with separator |

Secondary gets `merged_into_id = main.id` (soft-delete).

### Conflict resolution UI

Surfaces in admin UI: "2 people merged: <name>." Manager can review and trigger un-merge within 30 days (using `prior_secondary_snapshot` jsonb saved at merge time).

## Async merge — Deal layer

Mirrors the Attio `Merger of Deals` workflow but cleaner.

Trigger: a Deal gets `merge_with_deal_id = X` set (manager UI). Worker:

1. Identifies primary (older) vs secondary (newer)
2. Multi-value fields: union
3. First-touch UTM fields: keep primary's; if primary's null, take secondary's
4. Activities/Interactions/Tasks: re-point to primary
5. Comment on primary's owner: "Deal merged with <secondary.name>. New owner is you."
6. Secondary marked `merged_into_id`, hidden from default views
7. Audit row in `deal_merges`

## What about the "looks similar but not identical" case?

E.g. same name + same email domain but different phones — possibly same person, possibly not. We **don't** auto-merge these. Surface as a "Possible duplicate?" hint in the UI:

```sql
SELECT * FROM people
WHERE id != $1
  AND (
    similarity(name_display, $2) > 0.7
    OR email_domain($3) = email_domain(email_normalized)
  )
```

Manager decides. Auto-merging on weak signals is how data integrity goes wrong.

## What today does badly that we fix

| Today | Rebuild |
|---|---|
| `'+' + phone` (no E.164 parsing) | Real libphonenumber parsing with country fallback |
| Phone+email OR match without normalization (e.g. `+37368012345` vs `068012345` are different records) | Normalized E.164 single key |
| 2nd-tier conflict resolution by inspecting merge JSON | First-class merge audit + un-merge support |
| Read-only field exclusion in JS code | Schema-level — read-only fields never appear in merge input |
| `Merging Contacts` n8n on every phone update | Postgres trigger or worker on `people` UPDATE where `phone_e164` changed |
