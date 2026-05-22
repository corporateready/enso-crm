# n8n workflow inventory — ENSO operational stack

Source: `https://n8n-svgqc-u17606.vm.elestio.app/api/v1/workflows`, pulled 2026-05-19.
33 workflows total, 25 active, 8 inactive. ~1,200 nodes across all flows.

## By function

### Inbound capture → Attio Activities

| Flow                                       | Active | Nodes | Targets                                                       |
|---                                         |---     |---    |---                                                            |
| Forms Workflow for Attio                   | ✅     | 32    | api.attio.com, chat.googleapis.com, webhooks.fivetran.com     |
| Facebook Lead Ads Forms                    | ✅     | 34    | facebook.com, api.attio.com, webhooks.fivetran.com            |
| Social Workflow for Attio                  | ✅     | 26    | api/app.respond.io, api.attio.com, webhooks.fivetran.com      |
| Calls Workflow for Attio                   | ✅     | **119** | binaagency.pbx.moldcell.md, zadarma-signer.onrender.com, api.attio.com, golden-marmoset-28557.upstash.io, webhooks.fivetran.com |
| Parents \| ARTIMA Incoming Calls           | ✅     | 16    | n8n self, chat.googleapis.com                                 |
| pbx-n8n-workflow                           | ✅     | 6     | webhook                                                       |
| Sub \| Incoming Calls → Posthog Events    | ✅     | 2     | subworkflow                                                   |
| AVRAM IANCU Incoming Calls                 | off    | 3     | superseded by main Calls flow                                 |
| Vanzari Imobiliare Incoming Calls          | off    | 3     | superseded                                                    |
| TEST Incoming Calls                        | off    | 3     | test                                                          |

### Identity & deal creation

| Flow                                       | Active | Nodes | Notes                                                         |
|---                                         |---     |---    |---                                                            |
| Merging Contacts                           | ✅     | 14    | People dedup, hits api.attio.com + app.attio.com              |
| Creating a Deals                           | ✅     | 22    | Activity → Deal                                               |
| Merger of Deals                            | ✅     | 14    | Master/secondary deal merge                                   |
| Adding Project ID by Project Name          | ✅     | 17    | **Lookup compensating for the schema-level project disagreement** |

### Routing

| Flow                                       | Active | Nodes | Notes                                                         |
|---                                         |---     |---    |---                                                            |
| Routing Automation                         | ✅     | 38    | Hits api.attio.com + api.respond.io                           |
| Distribution of Deals                      | ✅     | 24    | Round-robin assignment                                        |

### Sequences engine (the SLA / next-task system)

| Flow                                                          | Active | Nodes  | Notes                              |
|---                                                            |---     |---     |---                                 |
| First Sequence \| Lead Claimed \|\| Social \ Call \ Form     | ✅     | 24     | Webhook-triggered on stage entry   |
| First Sequence \| Connected \|\| Social \ Call \ Form        | ✅     | 24     | Same                               |
| Sequence \| Lead Claimed \|\| Disposition and Outcome Variants | ✅   | **155**| Per-disposition/outcome branching  |
| Sequence \| Connected \|\| Disposition and Outcome Variants  | ✅     | **139**| Same                               |
| Sequence \| Waitings \|\| Social \ Call \ Form               | ✅     | **261**| **3× cron triggers**. Overdue + warning fan-out |
| Deferred Demand                                               | ✅     | 11     | Deferred-state handling            |
| Tracking Deal Progress by Status                              | ✅     | **91** | Stage transition handler           |

### Outbound / engagement

| Flow                                       | Active | Nodes | Notes                                                |
|---                                         |---     |---    |---                                                   |
| Customer.io Audience to Facebook           | ✅     | 12    | Audience → graph.facebook.com                        |
| Webhook to Customer.io                     | off    | 0     | dead                                                 |
| ARTIMA \| iCal Calendar RU → Google Chat   | ✅     | 2     | Calendar event alert                                 |
| ARTIMA \| iCal Calendar RO → Google Chat   | ✅     | 2     | Same                                                 |
| ARTIMA \| Customer.io Forms → Google Chat  | off    | 2     | dead                                                 |

### Plumbing

| Flow                                       | Active | Nodes | Notes                                                |
|---                                         |---     |---    |---                                                   |
| Error Logging                              | ✅     | 2     | errorTrigger → Google Chat                           |
| N8N \| Google Chat \| Claude Code          | ✅     | 4     | Uses **Gemini** (generativelanguage.googleapis.com), name misleading |
| test-pbx-event                             | ✅     | 1     | test                                                 |
| My workflow / My workflow 2                | off    | 2/2   | junk                                                 |

## Key infrastructure dependencies surfaced

- **api.attio.com** — 16 workflows hit it. Replacing Attio = touching every one of these.
- **api/app.respond.io** — wired into Routing, Distribution, Social, **and both Sequence Disposition flows**. Swap to Chatwoot is invasive, not a one-line change.
- **binaagency.pbx.moldcell.md** — direct Moldcell PBX endpoint, BINA-branded subdomain.
- **zadarma-signer.onrender.com** — custom Render-hosted service that signs Zadarma API requests. External code we don't have visibility into yet.
- **golden-marmoset-28557.upstash.io** — Upstash Redis used by `Calls Workflow for Attio`. Likely dedup / in-flight call state. This is the "Deduplication" box in Miro.
- **webhooks.fivetran.com** — Forms, Social, Calls, FB Lead Ads all push to Fivetran webhooks. Analytical side gets live signal, not only 4×/day polling.
- **n8n self-calling** (`n8n-svgqc-u17606.vm.elestio.app`) — sub-flows are invoked via HTTP webhooks against n8n itself, not n8n's `executeWorkflow` node. Maintenance smell.
- **generativelanguage.googleapis.com** — Gemini in the "Claude Code" chatbot flow.

## Zapier presence

Zero `zapier` / `hooks.zapier.com` domains across all 33 workflows. Zapier is either
already mostly retired or operating on a separate plane (Customer.io ↔ Attio inside
Zapier's UI). Confirm with the user.

## What this changes about the scope

1. **The "Sequences" object in Attio is really three giant n8n workflows + a cron**. 555 nodes encode per-stage SLA, disposition matrix, overdue warnings. In the rebuild this becomes a state-machine + job queue, not 555 nodes.

2. **`Adding Project ID by Project Name` exists because the schema is broken.** Lookup workflow → goes away when we have a real `projects` table.

3. **Two separate routing workflows** (`Routing Automation` 38n + `Distribution of Deals` 24n) suggest overlap or layering. In-house = one routing service.

4. **Call handling is split across at least 5 active flows** (`Calls Workflow for Attio`, `Parents | ARTIMA Incoming Calls`, `pbx-n8n-workflow`, `Sub | Incoming Calls to Posthog`, `test-pbx-event`) plus a sidecar service (`zadarma-signer.onrender.com`) plus Upstash Redis. The "Real-time Call Routing Service" in Miro = this whole constellation.

5. **Respond.io reach is wider than expected**. It's wired into Sequence Disposition flows, meaning sales-cadence step outcomes feed back to Respond. Chatwoot migration must preserve this loop, not just inbox parity.

6. **Fivetran webhooks already carry inbound events live.** The new CRM can keep this contract (emit events to BigQuery in real time) instead of being polled.
