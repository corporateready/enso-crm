---
title: Custom-code patterns
description: The recurring backend patterns the enso modules use — composite names, query hooks, system auth context, raw-ORM writes, best-effort jobs. Read this before adding code.
---

# Custom-code patterns

**Status: Shipped.** These patterns recur across the [enso modules](./enso-modules); learn them once.

Twenty is metadata-driven: objects/fields are defined as workspace metadata, not TypeORM entities, and data is reached through the **workspace ORM** scoped to a workspace + auth context. Our customizations hook into that runtime rather than touching core.

## Composite names (junctions have no label)

Twenty has no native lookup/rollup field, so junction objects (`personProjectAssignment`, `personProjectConsent`, `personRelationship`, `projectRoutingMember`) would display as "Untitled". We **materialize** a scalar `name` from the related records on write, via a `*-name.service` + a pre-query hook. See [junction-composite-name-pattern](../systems/junction-composite-name-pattern) for the full pattern. `opportunity-name` and `inbound-activity-name` apply the same idea to non-junction records.

## Query hooks (create/update interception)

Logic that must run on a write registers a hook with the `@WorkspaceQueryHook('<object>.<operation>')` decorator implementing `WorkspacePreQueryHookInstance` (or post). The hook's `execute(authContext, objectName, payload)` mutates `payload.data` before the resolver runs — this is where we inject the composite `name` and consent audit stamps. Example: `person-project-consent/query-hooks/*`.

## System auth context + permission bypass

A hook often must read **reference data** (the person/project behind a junction) to build a label — but the caller may be an API key or a Sales Manager **without read permission** on those objects. Reading with their context throws `PERMISSION_DENIED`. The fix:

```ts
const systemAuthContext = buildSystemAuthContext(workspaceId);
await globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
  const repo = await globalWorkspaceOrmManager.getRepository(
    workspaceId, 'person', { shouldBypassPermissionChecks: true },
  );
  // ...read regardless of the caller's permissions
}, systemAuthContext);
```

Use this for **reads needed to compute a write** — never to widen what a user can actually see.

## Raw-ORM writes bypass query hooks

Repository `insert`/`update` through the workspace ORM **bypass** the GraphQL resolver and therefore the query hooks. The pipeline relies on this: `consent-from-activity.service` writes consent via raw ORM so it does **not** re-trigger the manual-edit audit hook (no double-stamping). The trade-off: a raw write must **materialize the derived fields itself** — composite `name`, `position` (`maximum('position') + 1`), and the `createdBy`/`updatedBy` actor (`SYSTEM_ACTOR`). Mirror the create resolver's behavior.

## Best-effort background work

Pipeline side-effects (consent, attribution, notifications) must **never fail the primary flow**. Wrap them in try/catch and `logger.warn` on failure; skip `isSynthetic` (test) records. A missing Google Chat webhook or a consent write error logs and moves on.

## Workspace ORM returns nested composites

Composite fields come back **nested**, not as flat columns: `person.emails.primaryEmail`, `person.phones.primaryPhoneNumber`. Code in person-merge and consent reads them this way — don't expect `person.primaryEmail`.

## Mirror writes with a loop guard

`person-relationship-mirror.service` auto-creates the inverse relationship row and sets `mirrorOfId` on it pointing back to the canonical row. Hooks short-circuit when `mirrorOfId` is set, so the mirror never mirrors the mirror.
