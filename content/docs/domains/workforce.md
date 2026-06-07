---
title: Workforce
description: Members, availability, routing-pool membership. The routing primitives.
---

# Workforce

**Status: Shipped.** Members are standard Twenty `workspaceMember` records (no separate `users` table). The three routing primitives are live: self-service availability (`workspaceMember.isAvailableForRouting`), the admin-managed routing pool (`projectRoutingMember`), and sticky customer ownership (`personProjectAssignment`).

> **There is no `sales_manager` role gate on routing.** Any member who is *accepting leads* **and** on a project's routing pool is eligible. Selection is a per-opportunity uniform random pick — **not** round-robin, and there is **no** `last_assigned_at` / `active_clients_count` fairness state (it was removed). See [systems/routing](../systems/routing) and [systems/lead-pipeline](../systems/lead-pipeline) for the as-built algorithm; this page documents the member-side primitives.

## Members

Members are standard Twenty **`workspaceMember`** records — there is no separate `users` table. The one routing-specific field added to that object is:

- **`isAvailableForRouting`** (boolean, default false) — the self-service "accepting leads" switch. Custom field, not on the static `currentWorkspaceMember` type; toggled via the nav presence control (see [Availability](#availability)).

> Design-era fields (`role`, `last_assigned_at`, `max_active_clients`, `active_clients_count`, `sip_extension`, `chatwoot_agent_id`, language matching) are **not** part of the shipped routing path. `last_assigned_at` / round-robin and the `active_clients_count` soft cap were dropped entirely — routing keeps no per-member fairness state. SIP / Chatwoot identity mapping is handled in its own integration path, not as routing inputs.

## Routing pool — `projectRoutingMember`

The admin-managed pool — *which members receive leads for which project* — is the **`projectRoutingMember`** junction (project × member):

- `projectId`, `managerId` (→ workspaceMember), `isActive` (boolean)
- Composite `name` ("Project · Member"), auto-computed by `ProjectRoutingMemberNameService`.

Managed by admins via the **"Routing Team"** card on a Project (or the Routing Members table). A member with no active `projectRoutingMember` row for a project never receives that project's routed leads — this is the hard project gate that replaces Attio's `Users.assigned_projects` multi-select.

## Sticky ownership — `personProjectAssignment`

The customer-specific ownership record (person × project → member, `endedAt IS NULL`). Distinct from the routing pool: it sends *future* leads for that person+project straight to the named member (auto-claimed, even if they're offline). Written automatically on claim, not by hand. See [systems/routing § Claim → sticky](../systems/routing).

## Availability

`isAvailableForRouting = true` is the manual on/off switch. The member toggles it via the always-visible **"Accepting leads / Not accepting leads"** control in the nav when going on/off shift, into a meeting, or on vacation. Members who are off are excluded from **new** routing; their **existing** deals are untouched.

Richer availability (per-weekday working hours, out-of-office windows) is design-era only — not shipped. Add only if members ask.

## Roles

| Role | Can do |
|---|---|
| `admin` | Everything — workspace settings, user management, project CRUD, template editing |
| `sales_manager` | Work assigned deals, create ad-hoc tasks, view own deals + activity, complete tasks |
| `ops` | View all deals, reassign deals, set availability for other users, manage routing pool |
| `viewer` | Read-only — for execs, accountants |

Roles govern **permissions** (what a member can see/do), handled by Twenty's native role/permission system. They do **not** gate routing eligibility — a member of any role who is accepting leads and on a project's routing pool can be routed a lead.

## Routing pool

The candidate pool for a routed (non-sticky) lead is the **intersection** of two sets, with no role filter and no ordering:

- members **accepting leads** — `workspaceMember.isAvailableForRouting = true`
- members on the **deal's project pool** — an active `projectRoutingMember` (`isActive = true`) for `deal.projectId`

From that pool one member is chosen **uniformly at random, per-opportunity** (skipping any already tried on that deal). No round-robin, no `last_assigned_at`, no soft cap. Empty pool → the deal parks and retries.

→ See [systems/routing](../systems/routing) for the full algorithm (sticky auto-claim, claim window, reroute, park) and [systems/lead-pipeline](../systems/lead-pipeline) for the wiring.

## Workspace membership — not a separate object

Attio's Workspaces object had 8 fields and was barely used. The rebuild has no Workspaces table — there's one workspace, the team. Multi-tenancy by brand handled via `project_id` (see [open-questions](../open-questions) #3).

## SIP extension mapping (design-era)

> Not yet shipped, and unrelated to routing assignment — this is about call *attribution* ("who answered"), today still handled by `zadarma-signer`. When built, the SIP/Moldcell extension would live on the member (`workspaceMember`) record, not a separate `users` table.

The Roistat webhook delivers `sip` (the extension that answered); resolving it to a member by extension avoids the N+1 call to Zadarma's `/v1/pbx/internal/` per call event. A periodic job could reconcile Zadarma's extension list against members and flag discrepancies.

## What we drop from Attio's Users object

- `Available` custom field → `workspaceMember.isAvailableForRouting` (boolean, self-toggled).
- `Active Clients Count` → not used in routing (no soft cap, no fairness state).
- `Last Assigned At` → removed entirely; selection is per-opportunity random with no rotation state.
- `Assigned Projects` multi-select → the `projectRoutingMember` junction (admin-managed per-project pool).
- `Person` 1:1 link to People → gone; members are `workspaceMember`, not People.

## What we add

- `workspaceMember.isAvailableForRouting` — self-service "accepting leads" toggle.
- `projectRoutingMember` — admin-managed routing pool (project × member).
- `personProjectAssignment` — sticky customer ownership (person × project → member), written on claim.
- Native Twenty roles/permissions for authorization (Attio had no real RBAC).
