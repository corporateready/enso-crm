---
title: Stack
description: Definitive choices. Fork Twenty, deploy on Railway, Novu external + Knock internal, Trigger.dev for cross-system jobs.
---

# Stack

All major slots are now decided. Open sub-choices noted inline.

## Decisions

| Layer | Choice |
|---|---|
| **CRM** | Fork of [Twenty](https://twenty.com) (AGPL-3.0, internal use, modifications welcomed) |
| **Language** | TypeScript end-to-end (Twenty's stack) |
| **Backend** | NestJS (Twenty's), extended with our domain modules |
| **Frontend** | Next.js (Twenty's) + our custom screens |
| **ORM** | TypeORM (Twenty's) — keep their patterns in our modules |
| **Database** | Postgres (Twenty's managed schema + our additions) |
| **Cache + queue** | Redis with BullMQ (Twenty's) |
| **Host** | Railway (production from day 1, no staging) |
| **Auth** | Twenty's built-in auth, configured for Google Workspace SSO |
| **External notifications** | [Novu](https://novu.co) (OSS, MIT) — **self-hosted on Railway**, prospect-facing email/SMS |
| **Internal notifications** | [Knock](https://knock.app) — manager-facing in-app, Google Chat, email digests |
| **Cross-system jobs** | Trigger.dev (already in use by sops) |
| **In-CRM scheduled work** | Twenty's BullMQ on its own Redis |
| **Inbox (omnichannel)** | Chatwoot self-hosted |
| **Email transport** | Resend (or Mailgun via Novu/Knock) |
| **SMS transport** | Twilio (or local provider) — wired via Novu webhook |
| **Telephony** | Zadarma SDK direct in Twenty module (no Render signer) + Roistat webhook receiver in n8n |
| **PBX** | Moldcell + Zadarma (operator-side, unchanged) |
| **Glue** | n8n self-hosted on Railway (5-7 small integration flows) |
| **Analytical warehouse** | BigQuery (existing, unchanged) |
| **Observability** | Sentry (same as sops) + PostHog |
| **Object storage** | Twenty's choice — S3-compatible (Backblaze B2 or R2) |
| **Docs viewer** | Fumadocs (this scope doc) |

## Why a Twenty fork

Time-to-functional-CRM is the deciding factor. Greenfield is 18-25 weeks; Twenty fork is 8-11 weeks. The 8-12 weeks of difference comes from:

- Tables / kanban / calendar / search / comments / attachments / audit log / RBAC / multi-language UI / dark mode — all there
- Email + calendar sync (Gmail / Outlook) — Twenty has it
- Claude AI integration (summaries, drafting) — Twenty has it
- Mobile responsive UI — Twenty has it
- A working data model engine that handles custom objects + fields

Twenty's value is "build any CRM" — we modify it into "the ENSO CRM" by adding domain modules, custom screens, fixed schema constraints.

## Mental model: Twenty is our starting codebase, not our framework

We're not "extending Twenty" — we're shaping it into the ENSO CRM. The fork starts as 80% of a CRM and gets reshaped into our product through additions, modifications, and deletions.

Implications:
- Domain logic in NestJS modules sharing Twenty's Postgres connection — real ACID
- UI customizations in Twenty's Next.js — shared component library, shared auth, shared routing
- Schema as static TypeORM entities (not Twenty's metadata-driven dynamic schema where it fights us)
- Features we don't use get deleted, not left dormant
- Multi-workspace abstraction simplified down to one workspace
- Upstream merges tractable for ~6-9 months for security/critical fixes; after that the fork diverges and we own everything

## Modification discipline

Even with permission to modify anywhere, modify with intent:

✅ **Add what we need:**
- Our 7 first-class objects as new entities
- Our domain modules (`enso/routing/`, `enso/sequences/`, etc.) added to `twenty-server/src/`
- Real-estate-shaped custom screens added alongside Twenty's generic ones
- Google Workspace SSO via Twenty's existing OIDC support

✅ **Modify when their assumption fights ours, when we hit it in practice:**
- Multi-workspace → one workspace if/when the multi-workspace handling gets in the way
- Metadata-driven schema → static TypeORM entities for our objects if the metadata engine causes friction
- Workflow engine → our state machine for the core deal lifecycle (their workflow engine can coexist for user-editable rules)
- Generic deal/contact views → real-estate-shaped screens (additive first; replace if needed)

⏸️ **Defer deletion decisions — keep Twenty 1:1 with upstream for now:**
- Keep all modules (`messaging`, `calendar`, `connected-account`, `workflow`, `blocklist`, etc.) — they may be useful
- Keep email + calendar sync (Nylas) — managers may want Gmail visibility per deal
- Keep object/field editor UI — admin may want it for ad-hoc fields
- Keep billing, AI panel, all the modules — we observe what's used before deciding what to remove
- Delete only after we've operated the system and confirmed something is unused

❌ **Don't modify just because we can:**
- Their auth flow — works; extend with Google SSO via existing OIDC support
- TypeORM as the ORM — replacing is a multi-week project for no real gain
- Their migration system — use it for our entity migrations
- Their build tooling (Vite, Nest, Next, monorepo setup) — leverage what's set up
- Their realtime infrastructure (WebSockets, subscriptions) — extend, don't replace

**Principle**: add what we need; modify what fights us in practice; defer deletion until usage proves something is unneeded.

## Why production from day 1

Current Attio + n8n setup is in a building phase. No active users to disrupt. Parallel staging adds overhead without protecting anything. New stack goes live as it's built; cutover is webhook redirection at the end.

## Why Railway

- Twenty's docker-compose deploys cleanly via Railway templates
- Managed Postgres + Redis on the same platform
- Per-resource pricing aligns with small-team scale (~$80-120/mo total for Twenty + n8n + DBs at production volume)
- n8n has a Railway one-click
- Branching environments for previews if needed later
- Better DX than Elestio for a TS application stack

Production n8n stays on Elestio during the rebuild only because moving it adds zero value. After cutover we can migrate it to Railway or keep it where it is.

## Why Novu (external) + Knock (internal) split

Different audiences have different requirements:

| Need | Prospect-facing | Manager-facing |
|---|---|---|
| Multichannel from one API | yes | yes |
| Customizable templates, marketing tweaks them | yes | no (engineering authoring is fine) |
| In-app inbox component | not applicable | yes, critical |
| Google Chat integration (per brand space) | not applicable | yes, critical |
| OSS / self-hostable | strong preference | nice to have |
| Per-subscriber preferences | yes | yes |
| Cost model that scales to high prospect volume | matters | volume is small |

Novu and Knock each play to one side of this. Forcing one tool to do both forces a compromise.

## Self-hosted Novu — additional services

Novu self-host needs **MongoDB** alongside Postgres + Redis. Railway hosts MongoDB cleanly; one extra service in the project. Worth the trade for ownership and modification freedom.

## Open sub-choices

| Decision | Default | Defer until |
|---|---|---|
| Knock plan (free / starter / growth) | Free tier covers internal volume | When event count exceeds free tier (months in) |
| SMS provider in Novu | Twilio | Confirm whether Moldova-side SMS needs a local provider for delivery rates |
| Email transport | Resend | Could be SES if billing matters |
| Object storage provider | Backblaze B2 (cheap) | Phase 2 when we wire attachments |

## Deviations from sops's stack

| sops | enso-crm |
|---|---|
| Supabase (DB + Auth + Storage + Realtime) | Postgres on Railway + Twenty's auth (Google SSO) + S3-compatible + LISTEN/NOTIFY |
| Knock (all notifications) | Knock (internal only) + Novu (external) |
| No CRM — just SOPs | Twenty fork as CRM core |
| Vercel | Railway |

sops's stack works for sops. enso-crm has different anchors (Twenty's existing infra choices, prospect-facing multichannel reqs) that lead to different choices.
