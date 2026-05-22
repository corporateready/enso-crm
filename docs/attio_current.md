# Attio — current ENSO Development workspace

Snapshot of the live Attio schema as of 2026-05-19. Used as a reference
when drafting the in-house CRM scope. Pulled via Attio MCP.

Workspace: **ENSO Development** · Currency: **EUR** · 0 Lists in use.

Members: 4 — `corporate@enso.ro` (admin), `vormanji@enso.ro` (admin/bot),
`manager1oleg@gmail.com` (member), `sergiusurjconh@gmail.com` (member).

## Object sizes

| Object      | Attrs | Custom domain logic                                      |
|---           |---|---|
| Deals       | 65    | Stage funnel, project matching triad, timestamps, merge  |
| People      | 42    | 5 per-project text columns, residence/birth, languages   |
| Companies   | 33    | Mostly Attio Enrich defaults (B2B-shaped)                |
| Activities  | 33    | Inbound capture: UTM + caller/callee + chat + project    |
| Sequences   | 12    | Tasks engine: name, status, disposition, outcome, SLA    |
| Users       | 11    | Smart routing: Available, ActiveCount, LastAssigned, …   |
| Workspaces  | 8     | Barely used                                              |

## Deal stages (status field, 8 options, ordered)

1. Routing
2. Lead Claimed
3. Connected
4. Deep Qualification
5. Demo
6. Contracting
7. Closed | Won
8. Closed | Lost

## Pipeline State (select, 3 options)

`Active` · `Stalled` · `Deferred`. The 2D model. Manually toggled.

## Sequence Status (status field, 4)

`Today Tasks` · `Waiting` · `Done` · `Future Tasks`

## Sequence Disposition (select, 4) / Outcome (select, 5)

Disposition: `To Do` · `Completed` · `Done` · `Canceled`
Outcome: `Connected` · `Completed` · `Waiting` · `No Answer` · **`Owerdue`** *(typo, prod value)*

## Project selectors — five sources of truth, none agree

| Surface                              | Options                                                                                  |
|---                                   |---                                                                                       |
| `users.assigned_projects` (select)   | ARTIMA \| ENS2301, NEWTON HOUSE \| ENS1901, AVRAM IANCU \| ENS2402, **AVENEW BOTANICA \| ENS2101**, Vanzari Imobiliare |
| `people.<per-project>` (5 text cols) | ARTIMA, NEWTON, AVRAM IANCU, Vanzari, **ENSO LIVING \| ENS2501**                         |
| `deals.proposed_project_name` (3)    | NEWTON HOUSE, AVRAM IANCU, ARTIMA                                                        |
| `deals.proposed_project_id` (5)      | ENS2301, ENS1901, ENS2402, ENSVI, ENS2501                                                |
| `deals.confirmed_project_name` (3) / `_id` (5) | same as proposed                                                                |
| `deals.initial_project_name/_id`     | free text                                                                                |

Implications:
- **AVENEW BOTANICA** can be assigned to a User but has no slot on a Deal — its leads land in "Routing" with no project tag.
- **ENSO LIVING** exists on People + Deal (via ID-only) but no User can be assigned to it.
- Project Name and Project ID select-options are decoupled — you can pick "ARTIMA" + "ENS1901" by accident.

## Type-incorrect fields (text where typed should win)

Critical for analytics — none of these are filterable/sortable as their semantic type in Attio, and they all flow into BigQuery as strings:

- All deal timestamps: `timestamp_routing`, `_lead_claimed`, `_connected`, `_deep_qualification`, `_demo`, `_contracting`, `_closed_won`, `_closed_lost`, `_stalled`, `_deferred`, `_reactivated` — **stored as text** (should be `timestamp`).
- Counters: `stall_count`, `deferred_count`, `reactivated_count`, `routing_count` — **stored as text** (should be `number`).
- `m2_initial_lower_bound`, `m2_initial_upper_bound`, `m2_final` — text (should be number).
- `unit_of_interest`, `unit_final` — text (probably correct if free-form).
- Activities: `caller`, `callee` text (should be `phone-number`); `email` text (should be `email-address`).
- Sequences: `warning_sent` text (should be `checkbox`/boolean).
- Sequences: `completed_timestamp` text (should be `timestamp`).
- Deals: `first_contact_7` is the only deal-side timestamp stored as real `timestamp`. The rest of the funnel timestamps are all strings.

## Placeholder / never-finished fields

- `deals.reasons_for_refusal` multi-select options are literally `"Reason 1"` and `"Reason 2"`. Not in use.
- `deals.list_of_deals_for_merger_5` has empty title `"   "` — leftover duplicate from field iteration.
- `activities.related_person_6` slug suffix `_6` indicates ≥ 6 prior recreations of that field.
- `deals.client_type_status` and `activities.client_type_status` exist but `activities.client_type_status` only has two options — `Lead Claimed Tsaks` *(typo)* and `Connected Tasks`. Looks like a half-finished routing-mode flag.

## Typos in production

- `birdth_place_country` (People)
- `Owerdue` (Sequence Outcome)
- `Lead Claimed Tsaks` (Activities client_type_status)

## Attio-Enrich vestiges on Companies (B2B-shaped, ~useless for B2C real-estate buyers)

`estimated_arr_usd` ($0-$1M…$10B+ ranges), `funding_raised_usd`, `foundation_date`,
`employee_range` (1-10…100K+), `angellist`, `twitter_follower_count`, calendar/email
`interaction` fields, `strongest_connection_user`, `strongest_connection_strength`.

Keep only for actual B2B accounts (investors, partners). Most buyer Companies will be empty.

## Activities — the de-facto inbound CDP

Captures every inbound touch with full UTM (UTM Source/Medium/Campaign/Content/Term),
`landing_page`, `host`, `url`, `platform`, `traffic_type`, `social_page`, `social_activity_type`,
`chat_link`, `language`, `client_type`. Linked to `people` and `deals` via record-references.

All UTM and tracking fields are plain `text` — no enum/validation. Anything can land in `utm_source`.

## Sequences — the workflow engine, expressed as records

12 fields total. Each Sequence record = one task chain attached to one Deal.
Drives the per-stage SLA. `deals.deal_sequences` is the inverse multi-reference.

Mechanism: cron creates Sequence records when a Deal stage changes, writes `Sequence Due DateTime`,
manager works the next task, sets `Disposition`+`Outcome`, system either advances or warns.
`Warning Sent` is a text note (not a flag), so re-warns are not idempotent.

## Smart Routing primitives — actually clean

Live on `users`:
- `available` (boolean)
- `active_clients_count` (number) ✅ correctly typed
- `last_assigned_at` (timestamp) ✅
- `assigned_projects` (multi-select)
- `user_id` (unique text), `workspace` (multi-ref), `person` (1:1 to People)

These four fields are the only place where the routing model is properly typed.

## Field-shape summary for the rebuild

What's intrinsic (keep behavior):
- 8-stage funnel + 3-state (Active/Stalled/Deferred) overlay
- Project Matching triad (Initial / Proposed / Confirmed) — proves how deals evolve
- First-touch UTM frozen on Deal
- SLA timestamps per stage transition
- Smart Routing on Users
- Merge-deal logic (Primary / Secondary + list)
- Per-stage Sequences with disposition + outcome
- Deferred long-tail vs Stalled paused vs Active focus

What's Attio-workaround (don't port):
- Per-project text columns on People → m:m `person_project_interest` table
- Timestamps as strings → real timestamptz columns
- Counters as strings → SQL views over a `deal_state_history` event log
- 3-way denormalized project selects (Name+ID, both as selects) → single FK to a `projects` table
- 5 disagreeing project lists → one `projects` table, one FK
- `Warning Sent` as free text → job-queue idempotency key
- Sequence records → real workflow engine (state machine defs + task instances)
- Activities as a flat denormalized table → typed event stream (one row per inbound event)
- Companies B2B-Enrich fields → ditch except for actual B2B accounts (use a polymorphic `account` model or flag)

What's broken in the current setup (would carry forward if we 1:1 ported):
- Project lists out of sync across objects (AVENEW orphan, ENSO LIVING orphan)
- 11 deal timestamp fields that can't be queried by time
- Reason-for-refusal never populated
- Multiple typos baked into option values
- Dead duplicate fields with whitespace titles
