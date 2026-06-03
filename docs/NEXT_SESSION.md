# Next session — Chatwoot social-messages inbound

_**The design is SETTLED — read `content/docs/integrations/social-intake.md`
first** (the full as-planned spec; decisions D1–D10, architecture, Meta checklist,
phased plan). Then `docs/SESSION_HANDOFF.md` (full live state + operating
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

## Design — SETTLED (full spec: `content/docs/integrations/social-intake.md`)

The open questions are resolved. Scope is **bigger than passive intake**: besides
DM → `inboundActivity`, we also **embed the Chatwoot conversation inside the CRM**
(managers reply in-app), **patch the Chatwoot fork**, and **push assignment from
CRM into Chatwoot**. Key resolutions (decisions D1–D10 in the spec):

- **Human-only**, no AI auto-reply this phase.
- **Chatwoot = omnichannel backend**, deployed fresh on Railway from **our fork**;
  **one Meta app** for Messenger + Instagram (Instagram **Business Login**, needs
  Chatwoot **v4.1+**) + later WhatsApp Cloud API.
- **Granularity:** one `inboundActivity` per conversation, idempotency key
  `chatwootConversationId` (created on `conversation_created`/first inbound msg).
- **Inbox → project map** (FB+IG each): ENSO Dev Moldova→ESTATE (ENS2502), ENSO Dev
  Romania→LIVING (ENS2501), ARTIMA→ENS2301, AVRAM IANCU→ENS2402, VANZARI→ENSVI
  (unknown bucket). Umbrella inboxes use the country default; ad `ref` can sharpen.
- **Organic vs ads:** Chatwoot **drops Meta's ad referral** → **PATCH 1** persists
  `referral`(`ref`/`ad_id`) into `conversation.additional_attributes`. Marketing
  sets each ad's `ref = proj=<CODE>&utm_*…`. **Route iff a project resolves**
  (D9): ads/brand/umbrella → route; organic-on-Vanzari → activity-only (triage).
- **Identity:** phone → email → social handle (drop name-match).
- **Consent:** implied for the messaged channel, source `CHATWOOT`.
- **Embed:** iframe + invisible SSO (`/platform/api/v1/users/{id}/login`, 5-min
  token). Needs **PATCH 2** (X-Frame-Options/CSP for `crm.enso.ro`) and the shared
  parent domain **`crm.enso.ro` + `chat.enso.ro`** (SameSite cookies). Agents
  mapped to managers **by email**; **CRM drives assignment**, pushed into Chatwoot.
- **Webhook auth:** secret-in-path (Chatwoot can't send custom headers).
- **Meta:** **Business Verification ✅ done** — no external wait. Own/agency-managed
  assets likely run on **Standard Access** (verify in smoke test). Build is gated
  only by our own pace; **Phase 0 = deploy Chatwoot + DNS** is the first move.
- **Out of scope (defer):** AI auto-reply; outbound cadence; WhatsApp (until a
  number); Telegram/TikTok; the call channel (Roistat/Zadarma).

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
