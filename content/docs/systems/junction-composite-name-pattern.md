---
title: Junction objects with composite names (and mirror-write)
description: The reusable pattern for many-to-many junctions in our Twenty fork — composite labels via pre-query hooks, and bidirectional symmetry via post-query mirror-write.
---

# Junction objects with composite names (and mirror-write)

Twenty (the upstream CRM we forked) deliberately removed `ONE_TO_ONE` and
`MANY_TO_MANY` relation types in upstream PR #12482 (June 2025) — only
`MANY_TO_ONE` / `ONE_TO_MANY` remain. **Many-to-many is modeled via a junction
object**: a real entity with two `MANY_TO_ONE` relations to the linked sides.
This is the supported, intended pattern; re-adding the deprecated relation
types would cost weeks and permanently fork us from upstream.

This doc describes the reusable pattern we use for every such junction in
this codebase. It evolved through three live junctions:

- `personProjectAssignment` — person × project × manager (routing)
- `personRelationship` — person × person (family, labeled "Family" in UI)
- `personProjectConsent` — person × project (per-project marketing consent)

## The two problems junction objects create — and how we solve each

### Problem 1: junction records have no natural label

A row in `personProjectAssignment` (or any junction) is just a tuple of FKs.
The UI falls back to "Untitled". Twenty has no formula / lookup / computed
field type — you cannot declare `name = project.name + " · " + manager.name`
in metadata. Worse: relation cards on a person's record page only render
**scalar fields**, so even if the linked objects' names are accessible via
GraphQL, they don't appear on the card.

**Solution: materialize a composite `name` on write via pre-query hooks.**
We compute the label once at create/update time and store it in the scalar
`name` field — which IS rendered on cards and used as the label identifier.

```
personProjectAssignment.name   = "<project.name> · <member firstName lastName>"
personRelationship.name        = "<RelationType label> · <relatedPerson fullName>"
personProjectConsent.name      = "<person fullName> · <project.name>"
```

### Problem 2: bidirectional symmetry (when applicable)

For `personRelationship`, a single row (person=Ivan, relatedPerson=Dario,
type=CHILD) only appears on Ivan's `relationships` ("Family") card. Dario
doesn't see anything on his Family card — even though he's structurally
half of the relationship.

**Solution: mirror-write via post-query hooks.** When a canonical row is
created, we auto-create a mirror row from the other person's perspective
with the inverse type (CHILD ↔ PARENT, others symmetric). Updates and
deletes on the canonical cascade to the mirror.

Mirror-write is **not** appropriate for every junction. `personProjectConsent`
and `personProjectAssignment` are intentionally one-directional (consent is
not symmetric; assignment is one manager per pair). Only use mirror-write
where the semantic relationship is genuinely bidirectional.

---

## Pattern 1: composite-name pre-query hooks

### File layout

```
src/modules/enso/<junction-name>/
├── services/
│   └── <junction-name>-name.service.ts            ← computeName
├── query-hooks/
│   ├── <junction-name>-create-one.pre-query-hook.ts
│   ├── <junction-name>-create-many.pre-query-hook.ts
│   └── <junction-name>-update-one.pre-query-hook.ts
└── <junction-name>-query-hook.module.ts
```

Register the module by importing it in
`engine/api/graphql/workspace-query-runner/workspace-query-hook/workspace-query-hook.module.ts`
— that import is **how hooks get discovered** by Nest's reflector. Don't forget it.

### The `computeName` service

Three rules, all mandatory:

**(1) Read reference data with a system auth context that bypasses permissions.**
The caller may be an API key, an n8n integration, or a restricted Sales
Manager — they may lack read access to the objects feeding the label
(`project`, `workspaceMember`, `person`). Computing the label must never fail
because of caller permissions; otherwise the entire write fails with
`PERMISSION_DENIED`. The pattern (mirrors `BlocklistValidationService`):

```ts
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';

const systemAuthContext = buildSystemAuthContext(workspaceId);

return this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
  const repository = await this.globalWorkspaceOrmManager.getRepository<any>(
    workspaceId,
    'project',
    { shouldBypassPermissionChecks: true }, // <-- required
  );
  const project = await repository.findOne({ where: { id: projectId } });
  // ...
}, systemAuthContext);
```

**(2) Backfill missing inputs from the existing record on update.**

On `updateOne`, the payload only contains changed fields. If only the type
changed, `personId` and `projectId` aren't in the payload — but we still
need them to compute the full label. Read the existing row to fill the gaps:

```ts
if ((!projectId || !managerId) && record.id) {
  const existing = await assignmentRepository.findOne({ where: { id: record.id } });
  projectId  = projectId  ?? existing?.projectId  ?? undefined;
  managerId  = managerId  ?? existing?.managerId  ?? undefined;
}
```

**(3) Read composite (`FULL_NAME`) fields via the ORM, not the flat columns.**

Inside `executeInWorkspaceContext`, `person.name.firstName` and
`person.name.lastName` are accessible — **not** the flat `nameFirstName` /
`nameLastName` column names. The workspace ORM hydrates the FULL_NAME
composite for you.

### The three hooks

All three call `computeName` and merge the result into the payload's `data`.
The only delta:

- **createOne**: always recomputes (every field is in the payload).
- **createMany**: per-record map.
- **updateOne**: recomputes **only if the relations that feed the name changed.**
  Use an `in payload.data` check to guard, so unrelated updates don't churn
  the label:

```ts
const touchesNameInputs =
  'projectId' in payload.data || 'managerId' in payload.data;

if (!touchesNameInputs) return payload;
```

### Decorator key

Pre-query hooks use the **string-key shorthand**:

```ts
@WorkspaceQueryHook(`personProjectAssignment.createOne`)
```

The operation suffix is whichever workspace resolver this fires against:
`createOne`, `createMany`, `updateOne`, `updateMany`, `deleteOne`,
`deleteMany`, `destroyOne`, `destroyMany`, `restoreOne`, `restoreMany`.

---

## Pattern 2: mirror-write via post-query hooks (bidirectional only)

Only applicable when the semantic relationship is bidirectional. Currently
used only by `personRelationship`.

### The self-relation bookkeeping field

Add a `mirrorOf` field on the junction itself:

- **Type:** RELATION, MANY_TO_ONE, target = the junction itself (self-relation).
- **Nullable.** Null on canonical rows; points back to canonical on mirrors.
- **Hidden from views.** Internal bookkeeping; users should not see or edit it.

This field is the single source of truth for "am I a canonical or a mirror?"
— and it's the loop guard for every post-hook.

### The inverse-type map

For asymmetric kinships (parent/child) the type must flip on the mirror.
Symmetric kinships (spouse, sibling) map to themselves:

```ts
const INVERSE_RELATION_TYPE: Record<string, string> = {
  SPOUSE:  'SPOUSE',
  PARTNER: 'PARTNER',
  SIBLING: 'SIBLING',
  OTHER:   'OTHER',
  CHILD:   'PARENT',
  PARENT:  'CHILD',
};
```

### The four post-query hooks

| Hook | When | What it does |
|---|---|---|
| `createOne` POST | After canonical insert | Create mirror row with swapped people + inverse type, set `mirrorOfId = canonical.id` |
| `createMany` POST | After batch insert | Same, per row |
| `updateOne` POST | After canonical update | Re-derive mirror from current canonical state (people swapped, type inverted) |
| `deleteOne` POST | After canonical soft-delete | Soft-delete the mirror |

### Loop guard, applied uniformly

Every post-hook short-circuits when `mirrorOfId IS NOT NULL`:

```ts
if (!this.isCanonical(row)) return;   // row is itself a mirror — don't cascade
```

The mirror-write itself fires the createOne post-hook on the mirror row.
That row's `mirrorOfId` is set, so the guard trips and the hook is a no-op.
No recursion.

### Decorator key for post hooks

Post-query hooks use the **object form** with explicit type:

```ts
@WorkspaceQueryHook({
  key: `personRelationship.createOne`,
  type: WorkspaceQueryHookType.POST_HOOK,
})
```

Mixing pre and post hooks on the same operation is fine — they fire in
order (pre → resolver → post).

### Known limitation (v1)

Editing a mirror row **directly** (e.g. a manager opens the partner's page
and edits the auto-generated row) does not propagate back to canonical.
The pair will drift. Mitigation today: educate that "Family is edited on
the original person's record." If this becomes painful, v2 options:

- Block mirror edits in the resolver (raise an error on `mirrorOfId IS NOT NULL`).
- Detect mirror edits and re-route them to update the canonical (and let the
  canonical's update-hook re-sync the mirror).

---

## Building a new junction — the checklist

When adding a new junction object, in order:

1. **Object via metadata API.** `nameSingular` = lower-camel (e.g.
   `personProjectConsent`), `labelSingular` / `labelPlural` for the UI.
2. **Relation fields via metadata API.** Two `MANY_TO_ONE` relations from the
   junction to its linked objects. Twenty auto-creates the `ONE_TO_MANY`
   inverse on each target — name those inverses well (they show up as cards
   on the linked records' pages).
3. **Other fields.** Whatever the junction carries (timestamps, selects,
   booleans, notes).
4. **Composite-name service + 3 pre-query hooks + module** — copy the
   pattern from any existing junction; the structure is identical.
5. **Register the module** in `workspace-query-hook.module.ts`. Without this,
   hooks are silently never invoked.
6. **(Bidirectional only) `mirrorOf` self-relation + mirror service + 4
   post-query hooks** — only when the semantic link is symmetric / inverse.
7. **viewField auto-add** — for each new field, add it to the object's INDEX
   TABLE view + FIELDS_WIDGET view so it's visible by default. Internal
   bookkeeping fields (`mirrorOf`) stay hidden.
8. **Smoke test on production** via the data GraphQL: create / read inverse
   card / update / (mirror cases: verify both sides). Always delete the
   test row.

---

## Twenty constraints worth remembering

- **No formula / computed / lookup / rollup field type.** Derive on write
  via hooks (this pattern).
- **Record-page relation cards show scalar fields only** — a junction's
  display label MUST be a scalar TEXT field on the junction itself. Composite
  names on the `name` field are the answer.
- **`address` is a reserved field name** on Person. We use `residenceAddress`.
- **Introspection is disabled in production** — write queries against known
  shapes, don't `__schema` your way around. Test mutations in non-prod first
  when shapes are uncertain, or query the metadata `objects.fields`
  connection one object at a time (it truncates fields aggressively in bulk).
- **Views live on `/metadata`, not `/graphql`.** The `getViews` query
  accepts an `objectMetadataId` filter. ViewFields are a separate resource
  on the same endpoint.
