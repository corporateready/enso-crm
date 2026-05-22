---
title: enso-crm — scope
description: In-house operational CRM for ENSO/ARTIMA real estate, built as a Twenty fork with our domain modules.
---

# enso-crm

Operational CRM for ENSO + ARTIMA + Vanzari Imobiliare + AVENEW BOTANICA. Replaces Attio + Customer.io + Respond.io + most n8n + the Render-hosted `zadarma-signer`. The analytical half (`modern-data-stack/`) stays as-is.

## What this document is

A plan, with decisions locked except for the ~15 items in [open-questions](./open-questions). Build follows [phasing](./phasing) — 8-11 weeks direct to production, no staging.

## What the CRM owns

- Lead capture from Forms (PostHog → n8n), Roistat-mediated calls, Meta Lead Ads, Chatwoot social DMs, Zadarma direct
- Identity resolution by E.164 phone (primary) + email (secondary)
- Deal lifecycle: Routing → Lead Claimed → Connected → Deep Qualification → Demo → Contracting → Closed Won/Lost
- Smart routing by availability × project × round-robin with 3-min claim-or-reroute
- Sequences engine: template-driven task chains with disposition + outcome × open-ended manager tasks
- First-touch attribution preserved on Deal
- Event emission to BigQuery (preserves analytical contract)

## What stays outside the CRM

- **1C** — payments, contracts, legal records (system of record for money)
- **CPQ** — unit inventory + pricing + contract drafting
- **Roistat** — call-tracking + ad attribution; we consume its webhook
- **PBX** (Moldcell + Zadarma) — IVR + call queues configured operator-side
- **Chatwoot** — omnichannel inbox UI
- **n8n** — small role for webhook reception + brand alerts + Facebook audience sync
- **Novu** — external (prospect) notifications
- **Knock** — internal (manager) notifications
- **Trigger.dev** — cross-system cron jobs
- **BigQuery + dbt + Lightdash** — analytical warehouse

## Settled choices

| Slot | Choice |
|---|---|
| CRM core | Fork of Twenty (TypeScript, NestJS + Next.js, Postgres + Redis) |
| Host | Railway |
| Deploy mode | Production from day 1, no parallel staging |
| External notifications | Novu (OSS, MIT) — prospect-facing |
| Internal notifications | Knock — manager-facing |
| Glue | n8n self-hosted on Railway, ~5-7 small flows |
| Cross-system jobs | Trigger.dev |
| In-CRM jobs | Twenty's BullMQ on its own Redis |
| Telephony | Zadarma SDK direct + Roistat webhook |
| Inbox | Chatwoot self-hosted |
| Email | Resend (or SES) via Novu + Knock |
| SMS | Twilio (or local) via Novu webhook |
| Auth | Twenty + Google Workspace SSO |
| Docs viewer | Fumadocs (this site) |

See [stack](./stack) for the full table and rationale.

## Open

15 sub-decisions in [open-questions](./open-questions). The ones blocking work the most:
- Novu Cloud vs self-host (Q1)
- AVENEW + ENSO LIVING project status (Q2, Q3)
- Current lifecycle email cadences (Q15)
- CPQ API surface (Q10)

## How to read these docs

- [architecture](./architecture) — one-page topology
- [stack](./stack) — every layer's choice + why
- [phasing](./phasing) — 8 phases, week-by-week
- [open-questions](./open-questions) — what's still pending
- **Domains** — business objects (People, Deals, Projects, Sequences, Activities, Workforce)
- **Systems** — cross-cutting concerns (identity, routing, state machine, SLA, attribution, notifications)
- **Integrations** — external services (telephony, Chatwoot inbox, Novu, Knock, glue, downstream to CPQ/1C/BQ)
- **Migration** — from Attio

Reference research (in repo root `docs/`):
- [attio_current.md](../../docs/attio_current.md) — live Attio schema as of 2026-05-19
- [n8n_inventory.md](../../docs/n8n_inventory.md) — all 33 production workflows
- [n8n_intake_routing.md](../../docs/n8n_intake_routing.md) — actual dedup + routing logic
- [n8n_sequences.md](../../docs/n8n_sequences.md) — actual sequences engine logic
- [data_sample_findings.md](../../docs/data_sample_findings.md) — what real records look like
- [integrations_api_summary.md](../../docs/integrations_api_summary.md) — Zadarma + Roistat + Moldcell PBX APIs
