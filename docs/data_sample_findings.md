# What the actual records say

Sample: 20 newest Deals, 20 newest Activities, 10 newest People, all Users.
Pulled 2026-05-19 via Attio MCP. Sequences object timed out on list — too many records, processing speed not great either.

## Volume reality

- **3 active sales managers**, 1 inactive internal user (vormanji bot):
  - User 001 `apartamente5ani@gmail.com` — 26 active clients
  - User 002 `sergiusurjconh@gmail.com` — 28
  - User 003 `manager1oleg@gmail.com` — 17
  - User 100 `vormanji@enso.ro` — inactive
- **71 concurrent active clients** total across the team.
- Last 20 deals span **13 days** (2026-05-06 → 05-19) → **~1.5 new deals/day, ~45/month**.
- **All 3 managers are `assigned_projects = [all 5 projects]`.** No specialization. "Smart Routing by project" collapses to pure round-robin.

→ This is a small-team internal tool. Architecture should target ~10× headroom (single Postgres, single worker pool), not enterprise scale.

## All 20 recent deals are still in `stage: Routing`

Every one of the newest 20 deals is `stage: Routing`, `pipeline_state: Active`. None advanced to Lead Claimed → Connected → … in the recent window.

Two possible explanations, both interesting:
1. **The funnel actually does advance, but only the very freshest deals show in "newest"** — older deals progressed and aren't in this slice.
2. **Deals don't auto-advance when an owner is assigned.** Looking at owners: 11 of 20 have a human `workspace_membership_id`, 9 of 20 still have `owner.actor_type: api-token` (the routing bot owns them). That's **45% never claimed by a human**, sitting in Routing.

Either way the implication is the same: in the in-house rebuild, **`stage` should auto-derive from state transitions** (owner assigned → Lead Claimed; first outbound contact event → Connected; …) rather than being a manually-set field. Today people forget to advance it.

## "Missed" doesn't mean missed

All 12 call Activities in the sample have `status: Missed`, even ones where `call_answered_by` is populated:
- `Paza ARTIMA` (security)
- `Reception ARTIMA`
- `Техник` (technician)
- `""` (truly missed)

→ Status semantics are broken. The current logic labels every call "Missed" if a *sales manager* didn't pick up — front-desk / security / technician answers count as missed. This conflates two different things:
- **Did anyone at our org answer?** (Paza, Reception, Техник = yes)
- **Did a sales-eligible human answer?** (no)

The rebuild needs distinct dispositions: `unanswered` / `non-sales-pickup` / `sales-answered` / `voicemail`. The PBX (Moldcell + Zadarma) already routes by extension, so the answering extension category is knowable.

## AVENEW BOTANICA leaks past the schema

Two real deals exist in the sample with `initial_project_name: AVENEW BOTANICA` / `initial_project_id: ENS2101`. Confirmed: the schema gap is real, but **n8n routes them anyway via the free-text `initial_*` fields**. They just can't progress to `proposed_*` or `confirmed_*` (those selects don't include AVENEW). So today AVENEW deals exist but are second-class.

## Channel mix (last 20 deals)

- ARTIMA Business & Lifestyle: 10 (50%)
- Vanzari Imobiliare: 4
- NEWTON HOUSE: 3
- AVENEW BOTANICA: 2
- AVRAM IANCU: 0
- ENSO LIVING: 0

Last 20 activities by `activity_type`:
- Form Submission: 6 (mostly ARTIMA)
- Incoming Call: 6 (mostly ARTIMA + AVENEW)
- Social Message: 7 (mostly Vanzari Imobiliare, Instagram + Facebook)
- One outlier: "Incoming Message from AI CHAT" — Instagram, an AI-bot conversation logged as an Activity with a Person record `Support AI`. Real conversations are mixed with AI-bot interactions in the same stream.

## Identity & writes — all via one bot

Every record (Deal, Activity, Person) in the sample was created by `api-token: f249a89e-4ba5-4ad4-a6da-a27c5049bef2`. n8n is the **only writer**. Humans interact via Attio UI for reads + status changes only.

→ For the rebuild this is great: there's one ingestion seam (one token, one set of n8n workflows). No human-entered data to migrate beyond ownership/state changes.

## Test data in production

`Form | test tst1 | ARTIMA Business & Lifestyle` (2026-05-15), `Form | test f1 | …`, plus People records `test tst1` / `test f1` linked to a Company record. They're attached to real Deals and People. Migration needs an explicit cleanup pass — these will pollute counts and analytics.

## Person.name = phone number

For call Activities where no name was captured, the People record gets `name = "+37379628432"` (the phone). 7 of 10 sampled People had this pattern. That's not wrong, but it means `name` is a poor identity field. **Phone is the actual primary key** for ~70% of leads. The rebuild should treat phone (E.164-normalized) as the identity-resolution key, with name as enrichment.

## Sequences object overloaded

`list-records` on `sequences` timed out. The object likely has tens of thousands of records (every task ever = one record). Confirms my earlier read: Sequences-as-records is operating at a scale Attio's record model wasn't designed for. In the rebuild this is a `tasks` table with proper indexes, partitioning by `due_at`.

## Per-project text columns on People — mostly empty

Of the 5 per-project text columns on People (`artima_business_lifestyle_ens2301`, etc.), zero showed populated values in the 10-record sample. They exist as schema but the n8n workflows don't seem to write them. Possibly dead. Worth one more pull to confirm — but the active path for "what project is this Person interested in" appears to be via Activities/Deals, not these columns.
