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

- **Candidate pool** = `workspaceMember` with `isAvailableForRouting = true`.
  Project specialization is a deliberate no-op today (all available members are
  candidates); add a manager×project junction when the team specializes.
- **Sticky first**: if an active `personProjectAssignment` (person × project,
  `endedAt IS NULL`) exists and isn't excluded, route to that manager. Else
  **true round-robin**: order by `lastAssignedAt` asc (never-assigned first), then
  active-client count asc (open `ownedOpportunities`), then random.
- On assign: set `owner`, bump `lastAssignedAt`, mirror attempt into
  `routingCount`, enqueue notify, schedule the claim-check.
- **No candidates** (e.g. all excluded after reroutes) → `pipelineState=STALLED`
  + ops escalation alert.

## Claim window, reroute, escalation

- Claim-check is a **delayed BullMQ job** (`now + ENSO_CLAIM_WINDOW_MS`, default
  3 min; idempotent job id `enso-claim-check:<oppId>:<attempt>`).
- On fire: if the deal left ROUTING → **no-op** (claimed). Else reroute via a new
  RouteOpportunityJob with the prior owner added to `excludedManagerIds`
  (accumulated in the job payload — no audit object yet).
- At `attempt >= 5` (`MAX_ROUTING_ATTEMPTS`) → `STALLED` + ops alert instead of
  rerouting.

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

- Notifications are env-gated (deferred); in-app/Knock later.
- `isAvailableForRouting` / `lastAssignedAt` have no viewFields yet.
- Round-robin rotation needs ≥2 available managers to exercise fairness.
- No DB-level dedup guard (concurrent resolve jobs for one person×project relied
  on sequential processing in the smoke test).
- No `routingAttempt` audit object yet (excluded set lives in the job payload).
- Sequences/tasks on claim are not built.
