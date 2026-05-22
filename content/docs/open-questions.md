---
title: Open questions
description: What's left. Most architectural decisions are closed; remaining items are defaults or deferred.
---

# Open questions

After the last round, nearly everything is decided. What remains is either defaulted (with the option to override later) or explicitly deferred from v1.

## Defaults (override anytime)

| Slot | Default | Override path |
|---|---|---|
| UI primary language | English UI; prospect-facing copy in ro/ru/en | Choose Romanian or Russian as UI default if managers prefer |
| Mobile | Responsive web only; native later if needed | Add Capacitor wrapper or React Native screen if managers go to demos with phones, not laptops |
| Sequence template authoring | Engineer-only (code config) | Add UI editor in phase 2+ if sales-ops asks |
| SMS provider in Novu | Twilio | Swap to local MD/RO provider if delivery rates demand |
| Email transport | Resend | Swap to SES if cost matters at scale |
| Object storage | Backblaze B2 | Swap to R2 / S3 if egress matters |
| Knock plan | Free tier | Upgrade when event count exceeds free tier |
| "Missed" call semantics | Binary `Answered` / `Missed` (matches production) | Subdivide later if managers need finer granularity |
| `reasons_for_refusal` list | Capture as required field on `ClosedLost`, starter list refined post-launch | Sales-defined list once available |

## Deferred from v1 (revisit when ready)

| Topic | Why deferred | What unlocks it |
|---|---|---|
| **CPQ integration** | User direction: drop for now | CPQ team provides API details |
| **1C handoff signal** | Depends on CPQ | Same |
| **Unit inventory mirror** | Depends on CPQ read API | Same |
| **Lifecycle email cadences** in Novu | User direction: build infrastructure, add cadences later | Inventory existing Customer.io cadences when team is ready to map them |

These don't block v1 build. Deals reach `Contracting` and advance to `ClosedWon` manually until CPQ integration phase.

## Settled (locked across all rounds)

| Decision |
|---|
| CRM core: Fork of Twenty (TypeScript, NestJS + Next.js, Postgres + Redis) |
| Host: Railway |
| Deploy mode: Production from day 1, no parallel staging |
| External notifications: Novu (OSS), **self-hosted on Railway** |
| Internal notifications: Knock |
| Glue: n8n self-hosted on Railway (5-7 small flows) |
| Cross-system jobs: Trigger.dev |
| In-CRM jobs: Twenty's BullMQ on its own Redis |
| Inbox: Chatwoot self-hosted |
| Telephony: Zadarma SDK in Twenty NestJS module + Roistat webhook in n8n |
| Auth: Twenty's built-in + Google Workspace SSO |
| Identity: E.164 phone primary, email secondary |
| Activities vs Interactions: two separate tables |
| Sequences: state-machine-driven templates + ad-hoc manager tasks |
| Deal dedup: 14-day window, same person + same project |
| Multi-tenancy: one workspace, brand as project attribute |
| Customer.io / Respond.io / Zapier: fully retired |
| Source of audience truth: Twenty CRM |
| Facebook audience sync: n8n cron job |
| Deal stages: 8 (Routing → Lead Claimed → Connected → Deep Qualification → Demo → Contracting → Closed Won → Closed Lost). `Sales Accepted Lead` is old, dropped. |
| Disposition / outcome / pipeline_state / etc. enums | Inherited from Attio, typos fixed at migration |
