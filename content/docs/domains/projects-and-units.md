---
title: Projects and Units
description: Real-estate-shaped object model. Projects are first-class in CRM; units are owned by CPQ.
---

# Projects and Units

## Projects — finally a real table

Today's mess: project lists disagree across five Attio surfaces (Users, People per-project columns, Deals proposed/confirmed name+ID). Replaced by **one table**, FK'd everywhere.

```text
projects
├── id (uuid)
├── code (text, unique) — e.g. "ENS2301"
├── name (text, unique) — "ARTIMA Business & Lifestyle"
├── brand (enum: ARTIMA, NEWTON, AVRAM_IANCU, ENSO_LIVING, AVENEW_BOTANICA, VANZARI_IMOBILIARE, other)
├── active (boolean) — soft-disable without deleting historical refs
├── google_chat_space_id, google_chat_token (text) — for brand-specific alerts
├── posthog_project_key (text) — for analytics fan-out
├── created_at, updated_at
└── notes (text)
```

Initial seed: the five projects from current Attio plus AVENEW BOTANICA (which is implicitly real but missing from current schema selects).

| Code | Name | Status |
|---|---|---|
| ENS2301 | ARTIMA Business & Lifestyle | active |
| ENS1901 | NEWTON HOUSE Buiucani | active |
| ENS2402 | AVRAM IANCU | active |
| ENS2501 | ENSO LIVING | active |
| ENS2101 | AVENEW BOTANICA | active *(orphaned today — pending [open-questions](../open-questions) #5)* |
| ENSVI | Vanzari Imobiliare | active *(brand for resale/secondary market)* |

Any other Attio data referencing project name/ID becomes a `project_id` FK at migration.

## Buildings, blocks, phases — optional intermediate level

Some projects (NEWTON HOUSE Buiucani in particular) have multiple buildings. To stay simple and not pre-engineer, we **don't** model buildings as their own table — they're metadata on the Unit (which lives in CPQ). The CRM only needs to know which Project a Deal is for.

If sales asks "give me a view of NEWTON HOUSE Block A only", that's an LR query on CPQ unit metadata, not a CRM concept.

## Units — owned by CPQ, mirrored lazily

```text
units (CRM-side cache; truth lives in CPQ)
├── id (uuid)
├── cpq_unit_id (text, unique)
├── project_id (fk)
├── code (text) — building/floor/unit number string
├── status (enum: available, reserved, sold, off_market) — synced from CPQ
├── floor_plan_url, m2, bedrooms, bathrooms, list_price_eur — denormalized
├── last_synced_at
└── PRIMARY KEY (id)
```

Sync direction: CPQ → CRM (read-only mirror). One-way. CRM never writes to CPQ unit catalog. Reconciliation either via:

- **CPQ webhook on unit-state change** (if CPQ exposes one) — preferred
- **Hourly poll** of CPQ for changed units — fallback
- **Manual refresh** in CRM admin — escape hatch

If CPQ has no readable API at all, units sync becomes a phase-2+ concern and Deals reference units by free-text `unit_of_interest` (today's behavior) in the meantime.

→ See [open-questions](../open-questions) #14 — depends on what CPQ exposes.

## Customer-request side (the user-flagged concern)

You said:
> "we need to deal with customer requests I think"

Meaning: a prospect says "I want a 2-bedroom on floor 5+, ≤€120k". CRM should capture this even if no specific unit is picked yet. Two-level model:

### Level 1: Unit search criteria on Deal

Already there in current Attio (kept and typed properly):

```text
deals  (relevant subset)
├── interested_real_estate_type (text[]) — e.g. ['apartment', 'parking']
├── interested_sale_or_lease (enum: sale, lease)
├── budget_eur_min, budget_eur_max (numeric)
├── m2_min, m2_max (numeric)
└── interested_bedrooms_min (int, nullable)
```

These exist already in some form in Attio; we proper-type them.

### Level 2: Unit shortlist (Manager working a deal)

When the agent narrows down options for a client, they pin specific units:

```text
deal_units
├── deal_id (fk)
├── unit_id (fk → units, may be NULL until unit chosen)
├── role (enum: initial, proposed, confirmed) — replaces Attio's triad
├── m2 (numeric, nullable) — captured at time of proposal even if unit later changes
├── notes (text)
└── added_at
```

This replaces the Initial / Proposed / Confirmed project triad in Attio. The role here is **per-unit**, not per-project — which is actually how real estate works. A prospect can have:
- `initial` interest: ARTIMA Block A units in general (units may be NULL, just project_id set on the Deal)
- `proposed` shortlist: 3 specific units pinned
- `confirmed`: 1 specific unit going to contract

When CPQ → 1C handoff happens, the `confirmed` unit is what's referenced in the contract.

## Why not put units in CRM?

Three reasons:
1. **CPQ owns pricing, payment plans, contract terms, escrow flow.** CRM has no business writing to that.
2. **Unit availability is real-time** for a sales agent showing apartments — CPQ is already that source of truth.
3. **One source of truth.** Mirroring writes both ways is a sync nightmare.

## What the rebuild solves vs. today

| Today | Rebuild |
|---|---|
| 5 disagreeing project lists | One `projects` table, FK'd everywhere |
| AVENEW BOTANICA orphaned in Deal selects | First-class project, fully integrated |
| Project name + ID as separate decoupled selects | Single FK; name + code derived |
| `unit_of_interest` free text | `deal_units` with optional FK to `units` cache |
| Initial/Proposed/Confirmed per-project | Per-unit role enum on `deal_units` |
| `Adding Project ID by Project Name` n8n workflow (17 nodes) | Doesn't exist — no name/ID disagreement to patch |
