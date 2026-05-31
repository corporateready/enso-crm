# Next session — Chatwoot social-messages inbound

_Start here. Then read `docs/SESSION_HANDOFF.md` (full live state + operating
playbook), `content/docs/integrations/form-intake.md` (the template intake
channel), `content/docs/systems/lead-pipeline.md` (the downstream pipeline this
feeds), and `content/docs/domains/leads.md` (identity resolution + social
activity kind)._

## Where we are

The **form-intake channel is live** (PostHog form → n8n → `inboundActivity`), and
the **downstream pipeline is live and channel-agnostic**: any `inboundActivity`
(regardless of channel) triggers a CRM-side BullMQ pipeline that dedups/creates a
**Person**, creates/attaches an **Opportunity** (frozen attribution, m²), and
**routes** it (project-eligible + online pool, per-opportunity random; sticky
auto-claim; never-give-up reroute; routingCount = owner changes). So **a new
channel only needs to produce an `inboundActivity`** — opportunity + routing come
for free.

## The mission

Build the **Chatwoot social-messages inbound channel** (replaces Respond.io):

```
Social DM (IG / FB / WhatsApp / Telegram / Viber via Chatwoot)
  → Chatwoot webhook → n8n "Social Intake → CRM"  (mirror the form-intake workflow)
  → resolve (platform, project from inbox, identity) → dedup/create Person
  → create inboundActivity (kind = SOCIAL_MESSAGE)  ← STOP. The live pipeline does the rest:
       → Opportunity (source SOCIAL_DM) → routing → owner/sticky.
```

This is the social analog of `form-intake`. Use that workflow as the template
(same n8n instance, same CRM credential, same fast-ack + error-alert pattern).

## `inboundActivity` is already social-ready (verify, don't rebuild)

`kind` has `SOCIAL_MESSAGE`; `source` has `CHATWOOT` (+ `META`); plus
`platform` (INSTAGRAM/FACEBOOK/TELEGRAM/VIBER/WHATSAPP), `chatwootConversationId`,
`externalThreadId`, `body`, `person`, `project`, `externalId`, `distinctId`,
`status`, `isSynthetic`, full attribution + `submittedPayload`. The pipeline maps
`kind=SOCIAL_MESSAGE → opportunity.source = SOCIAL_DM` already.

## Open design questions to settle first (confirm before building)

1. **Where it runs** — recommend an **n8n "Social Intake → CRM"** workflow on the
   Railway n8n (mirror form-intake; the CRM POST hook fires regardless of caller).
   Alternative: Chatwoot webhook straight to a CRM endpoint. Decide.
2. **Granularity / dedup** — Chatwoot fires per **message** + `conversation_created`.
   We want **one `inboundActivity` per conversation** (or per inbound burst), not
   per message. Recommend: create on first inbound message / `conversation_created`,
   use **`chatwootConversationId` as the idempotency key** (skip if an activity
   with that conversation id exists); later messages don't create new deals (the
   person×project open-deal dedup handles that). Confirm.
3. **Inbox → project map** — which Chatwoot inbox = which CRM project (the analog
   of form-intake's host/path map; lives in the Resolve node). Unknown → Vanzari
   Imobiliare fallback. Need the inbox list + mapping.
4. **Social identity resolution** — dedup Person by **phone (WhatsApp) / email /
   social handle**. Decide identity keys + order + fallback, and where a social
   handle/id lives (Person field vs only `inboundActivity.externalId`). Chatwoot
   contact carries phone/email/identifier + social profile.
5. **Consent** — inbound social message = implied consent for that channel?
   (`personProjectConsent.whatsapp/sms/email`...). Likely yes for the channel they
   messaged on; decide which flags + source `CHATWOOT`.
6. **platform mapping** — Chatwoot inbox channel type → `platform` enum; `source =
   CHATWOOT`.
7. **Auth** — Chatwoot webhook auth (API token in header / shared secret in path),
   like the form-intake `x-intake-secret`.
8. **Out of scope (defer):** outbound agent replies / cadence via Chatwoot; the
   real-time call channel (Roistat/Zadarma) is a separate later session.

## Relevant live state

- **Pipeline** (channel-agnostic): `content/docs/systems/lead-pipeline.md`.
- **`inboundActivity`** (`cef40992-…`) — social fields ready (above).
- **Projects + the host/path map** for reference: `form-intake.md`.
- **personProjectConsent** (`40c511fa-…`) — per-project channel consent.
- Routing/notifications: routing is live; **notifications sidelined** (a Google
  Chat app "ENSO CRM" later — see SESSION_HANDOFF §5).

## Operating playbook (act immediately)

- Secrets in repo `/.env` (main repo root, **not** the worktree):
  `cd <repo-root> && set -a && source .env && set +a`. CRM:
  `$TWENTY_BASE_URL/graphql` + `/metadata`, `Bearer $TWENTY_API_KEY`. ⚠️ filter
  `deletedAt:{is:NULL}` on data queries.
- **Chatwoot creds:** `CHATWOOT_BASE_URL` / `CHATWOOT_ACCOUNT_ID` /
  `CHATWOOT_API_TOKEN` keys exist in `.env` but **read empty — confirm/obtain the
  real values** (self-hosted Chatwoot). Get the webhook + inbox setup from there.
- **n8n (write):** `N8N_RAILWAY_URL` + `N8N_RAILWAY_API_KEY`, REST `X-N8N-API-KEY`.
  Intake instance `https://n8n-production-d2a9.up.railway.app`; form-intake
  workflow `c6tgJmzSkxtsXTwb`, error workflow `OOfJPijdq1s08DQ9`, CRM credential
  `NYM0XzeLNTCwTydL`. Clone the form-intake workflow as the social template.
- Railway CLI authed (MCP token expired — use CLI). **Push to `main` = auto-deploy;
  needs explicit per-push approval.** ⚠️ **1 unpushed docs commit** may be pending
  from the prior session (`git log origin/main..HEAD`) — push or carry it.
- **Always clean up test records** (people/activities/opportunities/consents) after
  smoke tests, filtering on a test marker.
- New CRM hooks/jobs go under `packages/twenty-server/src/modules/enso/…`; worker
  jobs register in `JobsModule`; query hooks in `WorkspaceQueryHookModule`. The
  worker now builds from our repo (don't regress that).
