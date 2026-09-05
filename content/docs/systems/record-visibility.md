---
title: Record Visibility
description: Sales managers see only the records they own, on the objects they work. A separate audited lookup answers "is somebody already on this lead?" without handing over the record.
---

# Record Visibility

**Status: Built, not enabled.** The engine is inert until `ENSO_SCOPED_VISIBILITY_ROLE_IDS` is set on both the server and the worker. Clearing that variable is the kill switch.

Three layers decide what a member can see, and they are independent:

| Layer | Question it answers | Where it lives |
|---|---|---|
| **Object permissions** | Can this role reach this object at all? | Twenty native, `core.objectPermission` |
| **Field permissions** | Can this role see this field? | Twenty native, `core.fieldPermission` |
| **Record visibility** | Which *rows* of that object? | **Ours** — `src/modules/enso/record-visibility` |

## Why we built our own

Twenty ships record-level permissions, and they work. Every file implementing them is marked `/* @license Enterprise */`, and the LICENSE restricts those files to deployments with a valid Twenty Enterprise subscription. We do not have one and are not buying one, so we use none of that code.

Building our own turned out to have one real advantage. Twenty's engine compiles predicates through its record-filter DSL, which cannot traverse a one-to-many relation. Ours emits SQL, so it can — which is the only reason `person` can be scoped at all. A person has no owner column; ownership only exists on the `personProjectAssignment` rows hanging off it.

## Who owns what

Ownership is not a field. It is the model the CRM already had:

- a **contact** belongs to the manager of any of its `personProjectAssignment` rows, and to the owner of any deal it is the point of contact for
- a **deal** belongs to its `owner`
- a **task** belongs to its assignee
- everything else inherits from the contact, deal or company it hangs off

There is deliberately **no unassigned pool**. A record with no owner is visible to admins only. Routing assigns and auto-claims, so a manager should never need to browse unowned rows — and making them visible would make every unowned record visible to everyone.

Two escape hatches keep this from being hostile:

- a contact you created is yours **until somebody is assigned to it**, so a manually created lead does not vanish the moment you save it
- notes and tasks you authored stay yours regardless of target

## The rule map

`enso-record-visibility-rules.constant.ts` maps each object to a SQL predicate, ANDed onto every select, update, delete and soft-delete a scoped role runs. Objects absent from the map are not row-scoped — they are either reference data (`project`, `company`, `workspaceMember`) or hidden outright by object permissions.

`timelineActivity` is in the map for a non-obvious reason: its `properties` column carries a field-level diff of the record it describes, so an unscoped timeline hands over field values for records the manager cannot open.

The hook sits in the four TypeORM query builders under `src/engine/twenty-orm/repository/`, and honours `shouldBypassPermissionChecks` — so intake, routing, the worker and every `enso` service are untouched.

## What a scoped manager can reach

| Access | Objects |
|---|---|
| Read + write, own records | Contacts, Deals, Tasks, Notes, Outbound Activities, Project Assignments, Company Project Assignments, Family |
| Read only, own records | Inbound Activities, Deal State History, Project Consents, Consent Events, Sequence Runs, Marketing Enrollments |
| Read only, everything | Projects, Companies |
| Hidden | Workflows, Dashboards, PBX Numbers, Routing Members, Sequences |

Provisioned by `packages/twenty-server/scripts/provision-sales-manager-role.mjs`, which flips the role's defaults to deny before granting anything — so an object nobody thought about is invisible rather than world-readable. It also takes the role off API keys and agents, because the engine resolves the viewer from a *user* auth context and would not scope a key.

## The lookup lane

Scoping records also removes them from search, which leaves a manager unable to answer the one question they must answer before touching a lead: **is somebody already on this, and who?** Answering "no results" quietly invites a duplicate record, or a poached lead.

So `src/modules/enso/record-lookup` reads past record visibility on purpose, and pays for it by returning a projection instead of records:

| Shown | Withheld |
|---|---|
| Contact name | Phone and email in full |
| Masked phone / email, enough to confirm identity | Notes, recordings, attachments |
| Owning manager, per project | Deal amount, stage, lost reason |
| First contact, last touch | Consent detail, attribution |
| Deal status as `OPEN` / `WON` / `LOST` / `NONE` | Everything else |

It surfaces in the normal search panel as a **"Worked by someone else"** group under the manager's own results, and is completely inert for anyone who already sees every record — the server reports whether the viewer is scoped and does no work otherwise.

Guardrails, because a lookup that cannot be audited is just a slower way to browse the whole database:

- **30 lookups per manager per day**, counted in Redis
- **every call reported** to PostHog as `lead_lookup_performed`, carrying the owners whose book was read — never the search term, which is somebody's phone number
- **no navigation**: clicking a foreign match explains who holds it, it does not open a record

## Before enabling this

Ownership is barely populated. As of September 2026: 20 of 773 deals have an owner, and 4 `personProjectAssignment` rows exist in total. A manager switched on today would see an almost empty CRM. Backfill ownership first, then set the variable.
