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
| Owning manager, per project | Deal amount and lost reason |
| First contact, last touch | Consent detail |
| Deal status as `OPEN` / `WON` / `LOST` / `NONE` | Everything else |

Contacts are matched by name, email or trailing phone digits; **deals are matched by name too**, because a manager searching a deal they heard about otherwise gets nothing back at all. A matched deal is described by a constructed label — "Call deal" — never by its stored name, which is composite (`Call | 69… | ARTIMA`) and carries the contact's phone number.

Both surface in the normal search panel as an **"Elsewhere in the CRM"** group under the manager's own results, and the whole lane is inert for anyone who already sees every record — the server reports whether the viewer is scoped and does no work otherwise.

### The read-only profile

Clicking a match opens `ensoLeadProfile` in the side panel: the same projection, expanded far enough to decide what to do about the lead, and still not a record.

| On the profile | Still withheld |
|---|---|
| Masked identity, as in the lookup line | Real phone and email |
| Owner per project, **and their work address** so you can go and ask them | Message bodies, call recordings, notes, tasks |
| Deal label, stage, status | Deal name, amount, lost reason |
| First contact, last touch, re-engagement count | Consent detail, attachments, related people |
| Source, traffic type, utm source / campaign | Everything else |
| Inbound and outbound **counts and dates** | What was actually said |

Nothing on it is editable, because none of it is a record: there is no path from the panel back into somebody else's book. An unowned lead reads as "Nobody is working this lead yet" rather than being attributed to a colleague — taking it still goes through routing.

Guardrails, because a lookup that cannot be audited is just a slower way to browse the whole database:

- **30 lookups per manager per day**, counted in Redis. Opening a profile spends nothing extra: the ids can only have come from a search that was already counted
- **every call reported** to PostHog as `lead_lookup_performed` and `lead_profile_opened`, carrying the owners whose book was read — never the search term or the contact's name, which are somebody's personal data
- **no navigation to the record**: the profile is a projection served by our own resolver, so nothing reaches the scoped ORM

## Before enabling this

Ownership is barely populated — as of September 2026, 20 of 773 deals have an owner and 4 `personProjectAssignment` rows exist in total — but this is **not a backfill problem**. Of the 753 unowned deals, 686 are `CLOSED_LOST` and 78 are parked in `ROUTING`; none of them has a single answered call or outbound touch attached. There is no record of who worked them because nobody did. Ownership starts accruing the moment managers work leads through routing.

So the sequence is: put real managers in the workspace on the Sales Manager role, populate the project routing pools, then set the variable. A manager enabled before they own anything simply sees an empty CRM — not wrong, just useless.

One trap on the way: those 78 parked `ROUTING` deals poll forever, so adding the first routing candidate assigns and notifies the entire backlog at once. See [routing](./routing) — drain or close the backlog before opening the pool.
