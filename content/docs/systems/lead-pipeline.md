---
title: Lead pipeline (inboundActivity → Opportunity → routing)
description: As-built implementation of the downstream pipeline — a CRM-side BullMQ chain that turns an inbound activity into a routed deal. Design rationale lives in domains/deals.md and systems/routing.md.
---

# Lead pipeline (inboundActivity → Opportunity → routing)

Every inbound event (any channel) lands as an `inboundActivity`. This pipeline
turns it into an Opportunity and routes it to a manager. It runs **CRM-side**
(NestJS + BullMQ), not in n8n — n8n stays the thin per-channel ingestion layer;
the business logic (dedup, routing fairness, state machine, timers) lives in
tested code. Because the trigger is `inboundActivity` (not a form), **every
future channel** (calls, social, Meta) gets opportunity-creation + routing for
free.

Design rationale: [domains/deals.md](../domains/deals.md),
[systems/routing.md](./routing.md). This doc is the **as-built** wiring.

## Shape

```
inboundActivity.createOne  ──POST hook (server)──▶ enqueue ResolveOpportunityFromActivityJob
                                                         │  (ensoLeadPipelineQueue, worker)
                          resolve ─▶ route ─▶ notify     ▼
  resolve: dedup → attach or create Opportunity (stage ROUTING) + frozen snapshot
  route:   sticky-or-round-robin → set owner, bump lastAssignedAt, schedule claim-check
  notify:  Google Chat (best-effort, env-gated)
  claim-check (delayed 3 min): unclaimed → reroute (excl. prior owner); escalate at 5 → STALLED

opportunity.updateOne ──POST hook (server)──▶ on claim (stage left ROUTING w/ owner):
                                              upsert sticky personProjectAssignment
```

Decomposed into **distinct single-responsibility jobs** on purpose (one queue,
`ensoLeadPipelineQueue`): resolution, routing, and notification evolve and retry
independently; opportunity-creation strategy can vary per activity `kind`.

## Resolution (stage 1)

- **Skips**: `isSynthetic`, missing person/project, already-linked activity
  (idempotent).
- **Dedup**: reuse an OPEN opportunity for the same **person × project**,
  **any age** (`stage NOT IN (CLOSED_WON, CLOSED_LOST)`, **no time window**); else
  create. Attaching links the activity and stops; creating proceeds to routing.
  This matches legacy Attio's "person × project ever exists" (verified in the
  `Creating a Deals` workflow — `Get Deals` filtered only by `associated_people`,
  matched on `initial_project_*`, no recency cutoff), with one improvement: Attio
  matched *any* deal incl. closed ones; we exclude closed so a fresh inquiry after
  a closed-won/lost deal opens a new one. (Resolves open-question #9; the
  earlier 14-day proposal was dropped.)
- **Frozen first-touch snapshot** at creation: `utm*`, `firstTrafficType`,
  `firstLandingPage`, `roistatVisitId`, `source`, `project`, `pointOfContact`,
  and `m2Min`/`m2Max` from the activity's `m2Requested` (single requested size →
  both ends). Immutable on the deal thereafter.
- **`source` derives from the activity `kind`**, NOT `inboundActivity.source`
  (which is the *transport* enum: WEBSITE/ROISTAT/META/…). Map: FORM_SUBMISSION→
  FORM_WEBSITE, INCOMING_CALL/CALLBACK_REQUEST→CALL_INBOUND, SOCIAL_MESSAGE→
  SOCIAL_DM, LEAD_AD→LEAD_AD, else OTHER.
- **`firstContactAt`/`firstContactChannel` are left NULL** — they mark the
  manager's first *human* contact (the Routing→Connected trigger), not intake.
- Name: `"<Source> | <phone-or-name> | <project>"` (e.g. `Form | +373… | ARTIMA…`).

## Routing (stage 2)

- **Candidate pool** = `workspaceMember` with `isAvailableForRouting = true`
  **AND** an active `projectRoutingMember` (manager × project, `isActive`) for the
  deal's project. `projectRoutingMember` is the admin-managed routing pool — which
  managers receive leads for which project — distinct from the customer-specific
  `personProjectAssignment`. Managers self-toggle `isAvailableForRouting` (the nav
  presence switch); admins manage the per-project pool (the "Routing Team" card on
  a Project, or the Routing Members table).
- **Sticky → auto-claim**: if an active `personProjectAssignment` (person ×
  project, `endedAt IS NULL`) exists, assign that manager and move the deal
  **straight to `LEAD_CLAIMED`** (no claim window) — even if the manager is
  offline; it's their client.
- **Else round-robin** over the project pool: `lastAssignedAt` asc (never-assigned
  first) → active-client count asc (open `ownedOpportunities`) → random. Sets
  `owner` (stage stays ROUTING), bumps `lastAssignedAt`, mirrors attempt into
  `routingCount`, notifies, opens the claim window.

## Claim window, reroute — never gives up

- Claim-check is a **delayed BullMQ job** (`now + ENSO_CLAIM_WINDOW_MS`, default
  3 min; idempotent job id `enso-claim-check:<oppId>:<attempt>`).
- On fire: deal left ROUTING → **no-op** (claimed). Else **reroute forever** — the
  router rotates to the next manager (soft exclusion of just the prior owner; if
  they're the only one online it re-pings them). Routing **never hard-stops**.
- **Park + retry**: when the project pool is fully offline, `routeOpportunity`
  returns `no_candidates` and the deal parks in ROUTING (no owner); a claim-check
  heartbeat keeps retrying, so it resumes within one window of a manager coming
  online (verified). The only "stop" is everyone offline.
- **Admin heads-up** (not a stop): after `ADMIN_HEADSUP_AFTER_REROUTES` (=5)
  unclaimed reroutes, a one-time ops Google Chat nudge; routing continues.
- (The old "5 attempts → `STALLED`" hard stop and `markStalled` were removed.)

## Presence (self-service availability)

`twenty-front` shows an always-visible **"Accepting leads / Not accepting leads"**
toggle in the nav (`RoutingPresenceSection`, above the Other section). It flips the
current member's `isAvailableForRouting` via the generic record hooks
(`useFindOneRecord` / `useUpdateOneRecord` on `workspaceMember`) — the field is
custom and not on the static `currentWorkspaceMember` type. Offline managers are
excluded from new routing; their existing deals are untouched.

## Claim → sticky

`opportunity.updateOne` POST hook: when a deal leaves ROUTING with an owner,
upsert the active `personProjectAssignment` (person × project → owner). Written
**on claim only**, never on tentative assignment, so stickiness reflects who
actually handled the pair. Idempotent (no-op if already sticky to that manager;
repoints if the owner changed). Reuses `PersonProjectAssignmentNameService` for
the composite label.

## Wiring (where things are registered) — important

The server (API) and the worker boot **different root modules**, so hooks and
jobs register in different places:

| Concern | Module | Loaded by |
|---|---|---|
| POST hooks (trigger + claim) | `LeadPipelineModule` | `WorkspaceQueryHookModule` (server) |
| Jobs + their services | `LeadPipelineJobsModule` | `JobsModule` (worker via `QueueWorkerModule`) |

A job registered only in the query-hook graph is **never consumed** — the worker
doesn't load that graph. New worker jobs go in `JobsModule`. The queue
`ensoLeadPipelineQueue` is a value in the central `MessageQueue` enum (auto-registered)
and must also be added to `MESSAGE_QUEUE_PRIORITY`.

⚠️ **The worker must run our fork** — see SESSION_HANDOFF §2. It previously ran the
upstream `twentycrm/twenty:latest` image and executed no custom job. Any
worker-side feature depends on the worker building from our repo.

## Config (env, on both server + worker)

- `ENSO_ROUTING_CHAT_WEBHOOK_URL` — Google Chat webhook for assignment notices.
- `ENSO_OPS_CHAT_WEBHOOK_URL` — escalation alerts (falls back to the routing one).
- `ENSO_CRM_APP_URL` — base for clickable deal links in messages.
- `ENSO_CLAIM_WINDOW_MS` — claim window override (default 180000).

All notification paths are **best-effort**: a missing/failed webhook logs a WARN
and never fails routing.

## Known limitations / next

- Notifications are env-gated (deferred); set `ENSO_ROUTING_CHAT_WEBHOOK_URL` (+
  ops/app-url) on both services to enable Google Chat; in-app/Knock later.
- `workspaceMember.isAvailableForRouting` / `lastAssignedAt` have no viewFields
  (the nav presence toggle covers availability self-service; admins setting it
  per-other-member would need the field on a view).
- Round-robin **rotation** across ≥2 managers wasn't exercised in the smoke test
  (single manager → re-ping path). Project-pool filtering, sticky auto-claim, park,
  and park→resume all verified end-to-end.
- The N=5 admin heads-up is logic-verified (same `notifyEscalation` path), not
  timed in the smoke test.
- No DB-level dedup guard (concurrent resolve jobs for one person×project relied
  on sequential processing in the smoke test).
- No `routingAttempt` audit object yet (excluded owner lives in the job payload).
- Parked deals keep a per-deal claim-check heartbeat (~every window) until routed
  — fine at this scale; consider a single cron sweep if stuck-deal volume grows.
- Sequences/tasks on claim are not built.
