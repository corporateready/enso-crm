---
title: Glue (n8n)
description: n8n's small role in the new architecture — 5-7 integration flows. Zapier retired entirely.
---

# Glue · n8n

After the rebuild, n8n owns only **integration glue at the edges**. State machines, dedup, SLA, routing, sequences — all gone from n8n and into Twenty.

## What n8n keeps

| Flow | What it does | Why in n8n |
|---|---|---|
| **Roistat → CRM** | Receive Roistat call webhook; normalize payload; POST to Twenty intake endpoint | Webhook orchestration is n8n's natural shape |
| **Zadarma direct → CRM** | Same for non-Roistat-tracked Zadarma calls (internal/direct lines) | Same |
| **Web form → CRM** | Receive form POST from PostHog (or directly from form code); normalize; POST to Twenty | Same |
| **Meta Lead Ads → CRM** | Use n8n's native Meta Lead Ads trigger (OAuth handled by n8n); POST to Twenty | Saves us from reimplementing Meta auth |
| **Chatwoot → CRM** | Receive Chatwoot conversation webhooks; POST Activity events to Twenty | Same |
| **Facebook Ads audience sync** | Cron: query Twenty for "active prospects in segment X", push to Facebook Marketing API | Has FB node native; sales-ops may tune criteria |
| **Error logging** | n8n errorTrigger → Knock → Ops Google Chat | Existing pattern |

That's ~7 flows. Production today has 33. Net: ~26 flows retired.

## What n8n loses

All flows below are **either deleted (retired with Attio) or rebuilt as Twenty NestJS modules**:

| Flow today | Replaced by |
|---|---|
| Calls Workflow for Attio (119 nodes) | n8n thin Roistat/Zadarma receivers + Twenty's `intake-call` module |
| Forms Workflow for Attio (32 nodes) | n8n form receiver + Twenty's intake module |
| Social Workflow for Attio (26 nodes) | n8n Chatwoot receiver + Twenty's intake module |
| Merging Contacts (14 nodes) | Twenty's `identity-resolution` module with DB transactions |
| Merger of Deals (14 nodes) | Twenty's `deals` module merge endpoint |
| Creating a Deals (22 nodes) | Twenty's `deals` module |
| Routing Automation (38 nodes) | Twenty's `routing` module |
| Distribution of Deals (24 nodes) | Twenty's `routing` module |
| Adding Project ID by Project Name (17 nodes) | Doesn't exist — schema has `project_id` FK, no patch needed |
| Tracking Deal Progress by Status (91 nodes) | Twenty's `deal-state-machine` module |
| Deferred Demand (11 nodes) | Twenty's pipeline_state lifecycle (computed from `deal_state_history`) |
| All Sequence flows (~770 nodes) | Twenty's `sequences` module + BullMQ cron + `task_warnings` table |
| pbx-n8n-workflow / Parents ARTIMA / Sub Incoming Calls | Direct Roistat/Zadarma webhook receivers |
| All Customer.io alert flows | Direct Knock + Novu wiring from Twenty |
| Calendar to Google Chat alerts | Trigger.dev or Knock workflow |
| Junk workflows (My workflow, TEST flows) | Deleted |

## Zapier — fully retired

Zapier's residual presence:
- Currently in the call path for some Zadarma events (`zapier_first` / `zapier_second` keys in Calls workflow)
- Possibly FB Lead Ads bridge (user wasn't sure)
- Possibly Respond.io downstream

Retirement timing:
- Phase 2: Zadarma direct → CRM bypasses Zapier in the call path
- Phase 5: Respond.io retires → its Zaps die with it
- Phase 6: FB Lead Ads moves to n8n's native trigger if not already
- Phase 7: cancel Zapier subscription

## Endpoints n8n hits in the new world

```
POST /api/intake/call           — for Roistat + Zadarma normalized calls
POST /api/intake/form           — for web form submissions
POST /api/intake/lead-ad        — for Meta Lead Ads
POST /api/intake/social-message — for Chatwoot conversation events
POST /api/intake/general        — fallback for other webhook-driven activity creation
```

All on Twenty's domain (e.g. `crm.enso.ro`). Twenty's NestJS exposes these via the `intake` module; they handle dedup + person resolution + deal creation + downstream events.

Auth: shared secret in header. n8n is a trusted client.

## How n8n hits Twenty

Each n8n flow ends with one HTTP Request node:
- Method: POST
- URL: `https://crm.enso.ro/api/intake/...`
- Headers: `Authorization: Bearer <shared-secret>`
- Body: normalized JSON

Twenty's GraphQL API exists too but is overkill for these simple writes — REST suffices.

## Operational hygiene

Things to maintain in n8n going forward:
- Export workflows to git monthly (n8n's `workflows.json` per flow, committed to enso-crm repo)
- Use n8n's credential store, not URL-embedded tokens
- Use native `executeWorkflow` node for sub-flows, not HTTP self-calls
- One workflow per concern, target < 30 nodes per flow
- Every flow has an error path → Knock alert

## Where n8n is hosted

Production: Railway (alongside Twenty). The current Elestio instance is decommissioned after cutover.

## What's intentionally not in n8n

The whole point of this rewrite is that the following lived in n8n by historical accident (Attio's limitations) and now lives in code:

- State machines (deal stages, validation, rollback)
- Identity resolution + dedup with transactions
- SLA scanning + overdue warnings
- Smart routing with claim-or-reroute timers
- Sequence template task creation
- Disposition × outcome decision logic
- Pipeline state lifecycle counters

If anyone (engineer or admin) is tempted to put these back in n8n: they belong in Twenty's NestJS modules where they get transactions + tests + version control.
