---
title: Workforce
description: Users, availability, project assignments. The smart-routing primitives.
---

# Workforce

## Users

```text
users
├── id (uuid)
├── email (text, unique) — Google Workspace email
├── name_first, name_last, name_display
├── role (enum: admin, sales_manager, ops, viewer)
├── available (boolean, default true)
├── timezone (text, default 'Europe/Chisinau')
├── languages (text[]) — ro, ru, en — for language-matched routing if used later
│
├── -- routing primitives --
├── max_active_clients (int, nullable) — soft cap for routing
├── last_assigned_at (timestamptz) — for round-robin fairness
├── sip_extension (text, nullable) — Zadarma / Moldcell extension
├── -- m:n with projects --
│
├── -- chat --
├── chatwoot_agent_id (text, nullable) — for assignment writeback
├── google_chat_user_id (text, nullable) — for direct notifications
│
├── created_at, updated_at, deactivated_at (nullable)
```

### Active clients — computed, not stored

Today's `active_clients_count` is a number field that n8n increments and decrements imperatively. In Postgres it's a view:

```sql
CREATE VIEW user_active_clients_count AS
SELECT
  owner_user_id,
  COUNT(*) FILTER (WHERE pipeline_state = 'active' AND stage NOT IN ('ClosedWon', 'ClosedLost')) AS active_clients_count
FROM deals
WHERE owner_user_id IS NOT NULL
GROUP BY owner_user_id;
```

Routing reads the view in real-time.

## Project assignments

```text
user_projects
├── user_id (fk)
├── project_id (fk)
├── role (enum: primary, secondary) — primary = preferred routing target
├── assigned_at, assigned_by
└── PRIMARY KEY (user_id, project_id)
```

Replaces Attio's `Users.assigned_projects` multi-select. Lets us:
- Route AVENEW BOTANICA leads to AVENEW-assigned managers (currently broken)
- Route ENSO LIVING to ENSO-LIVING-assigned managers (currently broken — no manager has it)
- Distinguish primary specialist from backup
- Trail when assignments changed

## Availability — and what "available" means

`available=true` is the manual on/off switch. Manager toggles when going on/off shift, taking a meeting, on vacation.

Additional implicit availability factors (Phase 2+ if needed):

- **Working hours**: `users.working_hours_jsonb` per weekday (start/end in user timezone). Routing skips users outside hours.
- **Out-of-office**: `user_unavailability(user_id, from_at, to_at, reason)` — overrides `available`.
- **Soft cap**: if `active_clients_count >= max_active_clients`, the user is deprioritized but not excluded.

→ Decision: start with just `available` boolean (matches today). Add the rest only if managers ask.

## Roles

| Role | Can do |
|---|---|
| `admin` | Everything — workspace settings, user management, project CRUD, template editing |
| `sales_manager` | Work assigned deals, create ad-hoc tasks, view own deals + activity, complete tasks |
| `ops` | View all deals, reassign deals, set availability for other users, manage routing pool |
| `viewer` | Read-only — for execs, accountants |

Authorization at the route/action level + Postgres row-level via Auth.js session check (not RLS, since we're not on Supabase).

## Routing pool

Effective pool of users for new-deal routing:

```sql
SELECT u.*
FROM users u
JOIN user_projects up ON up.user_id = u.id
WHERE u.role = 'sales_manager'
  AND u.available = true
  AND u.deactivated_at IS NULL
  AND up.project_id = $1  -- the deal's project
ORDER BY (
  -- proper round-robin: oldest last_assigned wins
  COALESCE(u.last_assigned_at, '1970-01-01'),
  RANDOM()  -- tiebreaker
);
```

Returns ordered candidates; routing picks the first. This is *true* round-robin, unlike today's random pick.

→ See [systems/routing](../systems/routing) for the full algorithm (claim window, reroute, escalation).

## Workspace membership — not a separate object

Attio's Workspaces object had 8 fields and was barely used. The rebuild has no Workspaces table — there's one workspace, the team. Multi-tenancy by brand handled via `project_id` (see [open-questions](../open-questions) #3).

## SIP extension mapping

For the "who answered" feature (today implemented by `zadarma-signer`):

```text
users
├── sip_extension (text, nullable) — '101', '102', etc.
└── moldcell_extension (text, nullable) — separate if PBX uses different numbering
```

The Roistat webhook delivers `sip` (the extension that answered). We resolve to `user_id` by looking up `sip_extension` or `moldcell_extension`. No more N+1 call to Zadarma's `/v1/pbx/internal/` per call event.

Periodically (daily?), a background job pulls Zadarma's extension list + employee names and reconciles with our `users` table — flagging discrepancies for admin attention.

## What we drop from Attio Users object

- `Available` (kept, but as `boolean` not custom field)
- `Active Clients Count` (computed view)
- `Last Assigned At` (kept, but written by routing service)
- `Assigned Projects` multi-select (replaced by `user_projects` m:n table)
- `Person` 1:1 link to People object (gone — Users are not People; the conflation in Attio was a workaround)

## What we add

- `working_hours_jsonb` (optional, phase 2)
- `chatwoot_agent_id` for assignment writeback
- `sip_extension` for direct call resolution
- `max_active_clients` soft cap
- `languages` for language-matched routing if added later
- Role-based authorization (today's Attio has no real RBAC; everyone with access can edit anything)
