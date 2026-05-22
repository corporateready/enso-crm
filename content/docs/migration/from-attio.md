---
title: Migration from Attio
description: Object-by-object field mapping, cleanup, cutover plan.
---

# Migration from Attio

Cutover is gradual — see [phasing](../phasing). This page captures the **data migration mechanics** when phase 5 runs: pulling everything out of Attio cleanly into our schema.

## Source of truth at cutover

| Object | Source | Notes |
|---|---|---|
| People | Attio People | Strip Enrich fields, normalize phones to E.164 |
| Companies | Attio Companies | Filter to non-empty (investor/partner/corporate). Drop B2B-SaaS-Enrich fields. |
| Deals | Attio Deals | Parse text-stored timestamps into proper timestamptz. Reconcile project name+ID. |
| Activities | Attio Activities | Filter out `is_synthetic` (test rows + AI-bot chats). Re-resolve person_id via E.164 normalization. |
| Sequences | Attio Sequences | **Don't migrate.** Re-create open task instances from `(deal, stage, owner)` triples in the new templates. Historical sequences emit to BigQuery for analytics, but don't run as live tasks. |
| Users | Attio Users | Map to `users` table. Resolve SIP extensions from Zadarma. |
| Workspaces | — | Drop. Becomes brand attribute on project. |

## Per-object field mapping

### People

| Attio attribute | → | enso-crm column | Transform |
|---|---|---|---|
| `record_id` | → | `legacy_attio_id` | for audit; drop after 90 days |
| `name` | → | `name_first`, `name_last`, `name_display` | split on space |
| `email_addresses[]` | → | `email_normalized`, `email_alt[]` | first → primary, rest → alt; lowercase |
| `phone_numbers[]` | → | `phone_e164`, `phone_alt[]` | parse each via libphonenumber, default region MD |
| `language[]` | → | `language` | first value, normalize to `ro`/`ru`/`en` |
| `birdth_place_country` | → | `birth_country` | fix typo |
| `residence_country/city` | → | `residence_country/city` | unchanged |
| `current_country/city` | → | `current_country/city` | unchanged |
| `facebook/instagram/linkedin/twitter` | → | `facebook_url/instagram_url/linkedin_url` | drop twitter |
| `company` | → | `company_id` | re-resolve from migrated Companies |
| `artima_business_lifestyle_ens2301` (and the 4 other per-project text columns) | → | `person_projects` rows | one row per non-empty column, with FK to project |
| `nickname` | → | `nickname` | unchanged |
| Attio Enrich fields (first/last/next interaction, connection_strength, twitter_follower_count, etc.) | → | **drop** | not used |

### Deals

| Attio attribute | → | enso-crm column | Transform |
|---|---|---|---|
| `record_id` | → | `legacy_attio_id` | for audit |
| `name` | → | `name` | unchanged |
| `stage` | → | `stage` enum | direct map; resolve any "Sales Accepted Lead" string |
| `pipeline_state` | → | `pipeline_state` enum | direct map |
| `owner` (workspace_member) | → | `owner_user_id` | resolve to user_id |
| `value` (EUR) | → | `value_eur` | unchanged |
| `associated_people[]` | → | `deal_people` rows | m:n |
| `associated_company` | → | `company_id` on related person | the deal-company relation moves to person-company |
| `initial_project_name`/`_id` | → | `project_id` | resolve to projects.id by code |
| `proposed_project_name`/`_id` (multi-select) | → | `deal_units` rows with role='proposed' | one row per option; unit_id NULL |
| `confirmed_project_name`/`_id` | → | `deal_units` with role='confirmed' | same |
| `m2_initial_lower/upper_bound` (text) | → | `m2_min`, `m2_max` (numeric) | parse |
| `m2_final` | → | `deal_units[role=confirmed].m2` | parse |
| `budget_lower/upper_bound` (currency EUR) | → | `budget_eur_min`, `budget_eur_max` | unchanged |
| `sale_lease_8` | → | `sale_or_lease` enum | unchanged |
| `real_estate_type_3` (multi-select) | → | `real_estate_type[]` enum array | unchanged |
| `deal_type` | → | `deal_type` enum | unchanged |
| `first_contact_7` (timestamp) | → | `first_contact_at` | unchanged |
| `first_contact_communication_channel_1` (multi-select) | → | `first_contact_channel` enum | take first value |
| `timestamp_routing`, `timestamp_lead_claimed`, ..., `timestamp_closed_lost` (all text) | → | `deal_state_history` rows | parse each, create one history row per non-empty |
| `routing_count`, `stall_count`, `deferred_count`, `reactivated_count` (text) | → | **drop**; computed from history | — |
| `first_utm_*` | → | `first_utm_*` | unchanged |
| `respond_chat` (URL) | → | **drop** (legacy Respond.io ref) | log warning during migration if still active |
| `merge_the_deal`, `deal_merge_role`, `list_of_deals_for_merger` | → | `deal_merges` audit rows | reconstruct from existing state |
| `reasons_for_refusal` (placeholder values) | → | **drop**; reseed with real reasons | — |
| `cross_sale`, `interested_in_real_estate_that_we_have_on_hand`, `contacted_desired_brand`, `deal_changes` | → | `notes` jsonb (legacy bag) | preserve for reference |
| `demo_type`, `demo_date_time`, `demo_notes` | → | `demo_type`, `demo_scheduled_at`, `notes` | unchanged |
| `unit_of_interest`, `unit_final` | → | `deal_units[role=proposed/confirmed].notes` | preserve as free-text where unit_id not resolvable |

### Activities

| Attio attribute | → | enso-crm column | Transform |
|---|---|---|---|
| `record_id` | → | `legacy_attio_id` | audit |
| `name` ("Incoming Call from +373...") | → | derived from kind+person | reformat |
| `activity_type` | → | `kind` enum | map: "Incoming Call" → `incoming_call`, "Form Submission" → `form_submission`, etc. |
| `caller`/`callee`/`phone_8` | → | `caller_e164`/`callee_did` | parse via libphonenumber |
| `email` | → | `email_normalized` (denormalized for inbound matching) | lowercase |
| `language` | → | `language` enum | normalize |
| `project_name`/`project_id` | → | `project_id` | resolve |
| `social_activity_type`, `social_page`, `platform`, `chat_link` | → | `platform` enum, `external_thread_id`, `external_thread_url` | parse chat_link to extract IDs |
| `client_type`, `client_type_status` | → | **drop** (unused / placeholder) | — |
| `status` ("Missed" for all calls) | → | `call_status` + `sales_pickup` | derive proper split per [systems-domains/activities-and-interactions](../domains/activities-and-interactions) call status section |
| `call_answered_by` | → | `non_sales_pickup_by` if "Paza"/"Reception"/"Техник", else `answered_by_user_id` resolved | requires mapping table |
| UTM Source/Medium/Campaign/Content/Term | → | `utm_*` | unchanged |
| `traffic_type`, `source`, `host`, `url`, `landing_page` | → | same | unchanged |

### Sequences — don't migrate the records, re-derive

The Sequences object likely has tens of thousands of records (today's MCP `list-records` timed out). 95%+ are historical / completed / canceled — analytical value only. Don't replay them as live tasks.

Strategy:
1. **Live sequences** (status = "Today Tasks" or "Waiting", not archived) → re-create as `tasks` rows with `template_id` resolved from `sequence_name` parsing.
2. **Historical sequences** → bulk export to BigQuery (one event per sequence) for analytics continuity. Don't import into operational DB.

Recreation rule for live: parse `sequence_name` like "Call Interaction #1 | Lead Claimed | Active" → `{channel: call, iteration: 1, stage: LeadClaimed, status: active}` → lookup `sequence_templates.code = call.lead_claimed.first` → create `task` row.

### Users

| Attio attribute | → | enso-crm column | Transform |
|---|---|---|---|
| `user_id` | → | `legacy_attio_user_id` | audit |
| `primary_email_address` | → | `email` | lowercase |
| `person` (link to People object) | → | **drop** (broken concept) | — |
| `available` | → | `available` boolean | unchanged |
| `active_clients_count` | → | **drop**; computed | — |
| `last_assigned_at` | → | `last_assigned_at` | unchanged |
| `assigned_projects` (multi-select) | → | `user_projects` rows | one row per option; resolve project codes |
| `workspace[]` | → | **drop** | — |

## Data cleanup

Run as **part of** the migration script — don't migrate dirty:

| Cleanup | Detection | Action |
|---|---|---|
| Test data | `name` LIKE `'%test%'` OR `email` LIKE `'%@test.com'` | Filter out; log to ops |
| Placeholder reasons-for-refusal | Option value ∈ {"Reason 1", "Reason 2"} | Drop; reseed table |
| Typo "Owerdue" | Disposition value = "Owerdue" | Map to "Overdue" |
| Typo "Lead Claimed Tsaks" | Status value | Map to "Lead Claimed Tasks" |
| Typo "birdth_place_country" | Field rename | Fix on import |
| Duplicate `list_of_deals_for_merger_5` field | — | Drop attribute |
| AVENEW BOTANICA orphans | `initial_project_id = 'ENS2101'` but no project select supports it | Resolve to first-class project row, backfill `project_id` |
| Phone numbers without country prefix | `phone_e164` doesn't start with `+` | Re-parse with default region MD |
| AI-chat People records ("Support AI", "AI CHAT", "Chat's Al") | Detected by name pattern + lack of phone | Mark `is_synthetic`, separate from real prospects |

## Migration steps (when phase 5 runs)

1. **Snapshot**: Attio API full dump → JSON files
2. **Validate**: run cleanup detectors, log issues to migration report
3. **Transform**: scripts produce Postgres-shaped JSON
4. **Load**: batched `INSERT` into enso-crm Postgres
5. **Reconcile**: spot-check 100 random Deals, 100 random People for completeness
6. **Stream**: emit Activity + Deal + Stage history events to BigQuery to backfill analytics
7. **Flip webhooks**: Roistat / Zadarma / Chatwoot / forms / 1C webhook URLs change to enso-crm endpoints
8. **Stop n8n writes to Attio**: deactivate intake workflows
9. **Read-only Attio**: keep accessible for 30 days as historical reference
10. **Decommission**: cancel Attio subscription, archive export

## Verification queries

Run pre + post migration:

```sql
-- Count: deals by stage
SELECT stage, COUNT(*) FROM deals GROUP BY stage;

-- Count: people with phone
SELECT COUNT(*) FILTER (WHERE phone_e164 IS NOT NULL) AS with_phone,
       COUNT(*) AS total FROM people;

-- Activities by kind in last 30 days
SELECT kind, COUNT(*) FROM activities
WHERE occurred_at > now() - INTERVAL '30 days'
GROUP BY kind;

-- Live tasks by template
SELECT template_id, COUNT(*) FROM tasks
WHERE completed_at IS NULL AND archived = false
GROUP BY template_id;
```

Compare to pre-migration Attio counts. Discrepancies > 5% trigger a hold.

## Risks specific to this migration

| Risk | Mitigation |
|---|---|
| Phone normalization changes uniqueness (some Attio dupes become merged in our DB) | Pre-run merge dry-run, log conflicts, get manual approval for >100 merges |
| AVENEW deals' project_id is null today | Backfill by scanning `initial_project_id = ENS2101` |
| Historical sequence records won't import as live tasks | Accept — managers start with fresh task list; old sequence outcomes preserved for analytics only |
| BigQuery dashboards break if event-shape differs from current `staging.activities` | Test in dbt with a parallel staging schema before cutover |
| Manager familiarity drop on day 1 of using new CRM | Phase 4 trains managers on the new UI before phase 5 cutover |
