---
title: Phasing
description: 8-11 weeks, direct build to production, no parallel staging.
---

# Phasing

Production from day 1. No fan-out, no shadow run, no staging environment. Each phase ends with something usable in production.

## Phase 0 — Foundation (2-3 days)

- Fork `twentyhq/twenty` to `enso-crm/enso-crm` on GitHub
- Set up Railway project: Postgres, Redis, Twenty app + worker containers, n8n service
- Configure Google Workspace SSO via Twenty's auth
- Configure Sentry, base observability
- Run Twenty's first-boot, create our workspace + 1 admin user

**Exit**: Twenty up at a domain, login works, dashboard shows.

## Phase 1 — Object model + auth (1-2 weeks)

Keep Twenty's modules 1:1 with upstream; add ours alongside. Decide on deletions later based on actual usage.

Add our 7 first-class objects in `apps/twenty-server/src/enso/entities/`:
- `projects`, `people`, `companies`, `deals`, `activities`, `interactions`, `tasks` *(some of these — `person`, `company`, `task` — Twenty already has; we extend rather than duplicate)*
- Plus join tables (`person_projects`, `deal_units`) and history (`deal_state_history`, `task_warnings`)

Approach: static TypeORM entities for ENSO-specific objects; use Twenty's existing `Person` / `Company` / `Task` modules as the base and extend with our fields. Twenty's `Opportunity` becomes our `Deal` (rename or alias). Confirm pattern in Discovery Sprint Day 3.

Configure auth: extend Twenty's existing OIDC support for Google Workspace SSO. RBAC roles: `admin`, `sales_manager`, `ops`, `viewer`.

First custom screens (added alongside Twenty's, not replacing):
- Deal kanban grouped by stage with project + value + owner columns pinned
- Person timeline showing Activities + Interactions in one chronological view
- Project list with brand + active state

**Exit**: An admin can manually create a Deal in the UI, assign it to a manager, advance the stage. Twenty's existing UI still works (we haven't deleted anything yet).

## Phase 2 — Intake from external sources (1-2 weeks)

- 5-7 n8n flows for webhook intake:
  - Roistat call webhook → normalize → POST to Twenty
  - Zadarma direct webhook → normalize → POST to Twenty
  - Web form via PostHog → POST to Twenty
  - Meta Lead Ads → POST to Twenty
  - Chatwoot webhook → POST to Twenty
- Twenty side: `activities` records created from intake
- Dedup via `webhook_events(provider, external_id)` UNIQUE constraint
- E.164 phone normalization (libphonenumber) at intake
- Person resolution: lookup by `phone_e164` first, then `email_normalized`

**Exit**: A real Roistat call event lands in Twenty as an Activity linked to a Person within 3 seconds.

## Phase 3 — Domain modules in Twenty (3 weeks)

NestJS modules added to our fork:

- `identity-resolution` — phone + email dedup, async merge with database transactions
- `deal-state-machine` — stage transitions, per-transition validation, rollback, automatic timestamp writing
- `routing` — availability × project filter, true round-robin via `last_assigned_at`, 3-min claim-or-reroute via BullMQ
- `attribution` — first-touch UTM frozen at deal creation; Roistat `visit_id` linkage

Custom UI screens:
- Manager's "My Deals" view with claim button
- Deal detail with stage advance + required field validation gates
- Routing log (ops visibility)

**Exit**: A new Activity creates a Deal in `Routing`, gets assigned to a manager via smart routing, the manager claims it within 3 minutes (or it auto-reroutes), stage transitions work with field-validation gates.

## Phase 4 — Sequences + notifications (2-3 weeks)

- `sequences` module with template-driven task creation
- Sequence templates as code config (initially) — channel × stage × iteration → SLA + advance rule + follow-up template
- Tasks UI for managers (My Tasks list, kanban by template type)
- Disposition × Outcome decision matrix
- SLA scanner as a BullMQ cron job + `task_warnings` table with UNIQUE constraint for idempotency
- Knock wired: in-app inbox, Google Chat per brand space, daily digest email
- Novu self-hosted on Railway (Postgres + Redis + MongoDB)
- Novu wired: transactional prospect emails (welcome, demo confirmation, stage milestones). Lifecycle drip cadences out of v1 — added later
- Resend + Twilio providers configured in Novu and Knock

**Exit**: A new lead going through the full Lead Claimed → Connected loop generates the right tasks, sends the right notifications to manager and prospect, advances the stage correctly.

## Phase 5 — Chatwoot wiring (1 week)

- Chatwoot self-hosted instance running (Railway or existing host)
- Webhook receivers for conversation events
- Manager-side: reply to Chatwoot conversations from inside Twenty
- Assignment writeback (Twenty assigns deal → Chatwoot agent assignment updated)
- Custom attribute on Chatwoot conversation linking to Twenty deal

**Exit**: A prospect DMs ENSO's Instagram → conversation appears in Chatwoot, an Activity appears in Twenty, the deal opens for the responsible manager, they reply via Twenty UI.

## Phase 6 — Outbound + audience sync (1 week)

- Click-to-call via Zadarma SDK (NestJS service in Twenty)
- Zadarma extension sync as a Trigger.dev daily job
- Roistat outcome push-back as a Twenty event listener (on `deal.stage = ClosedWon`)
- Facebook audience sync as an n8n cron job querying Twenty + posting to Facebook Marketing API

**Exit**: A manager can click-to-call from a deal; closed deals appear in Roistat reports; Facebook audiences refresh daily.

**Out of scope for v1**: CPQ handoff and unit inventory mirroring — deferred until CPQ side provides API details. Deals reaching `Contracting` advance manually to `ClosedWon`.

## Phase 7 — Cutover + cleanup (1 week)

- Migrate any in-flight active deals from Attio (one-time export + transform script)
- Point all real webhooks (Roistat, Zadarma, web forms, Meta, Chatwoot) at the new n8n on Railway
- Verify no Attio writes for 48 hours
- Archive Attio export, schedule subscription cancellation
- Retire `zadarma-signer` Render service
- Delete dead Zapier zaps
- Update BigQuery dbt staging to consume new event shape
- Update Lightdash dashboards if any reference deprecated fields

**Exit**: Attio is read-only history; the enso-crm system is the only writer; analytics dashboards show consistent numbers.

## Timeline total

**~8-11 weeks for one engineer working full-time.** Phases 3 and 4 are the heaviest (~5-6 weeks combined). Phases 0, 5, 6, 7 are smaller (1 week each or less).

## Risks per phase

| Phase | Highest risk | Mitigation |
|---|---|---|
| 0 | Twenty's first-boot or Railway template issues | Plan a day of buffer; their Discord + docs are responsive |
| 1 | Twenty's metadata engine doesn't express our exact schema | Use raw NestJS modules + Postgres for things their engine can't do; don't force everything into their object UI |
| 2 | Webhook signature differences vendor-by-vendor | One day per source; test with replayed payloads |
| 3 | State machine + routing reliability across worker restarts | BullMQ has retry + dedup; test with deliberate kills |
| 4 | Getting disposition × outcome decisions right; SLA tuning | Start with conservative defaults from n8n's flows; tune from real usage |
| 5 | Chatwoot assignment API edge cases | Build with idempotency; logging |
| 6 | Zadarma click-to-call latency on cold SIP | Test from each manager's actual extension; have fallback |
| 7 | BigQuery dbt models break on new event shape | Run dbt against new event format in a parallel dataset before flipping |

## Explicitly out of scope

- Mobile native app (responsive web only)
- Multi-tenant brand separation (one workspace; brand as project attribute)
- CPQ deep integration beyond the handoff
- Direct 1C integration (1C consumes via CPQ)
- Replacing Roistat / PostHog / BigQuery / Fivetran
- A user-editable sequence template UI (engineer-authored config files for v1; UI later if asked)
