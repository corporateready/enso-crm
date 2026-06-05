---
title: Social intake (Chatwoot → CRM)
description: Design + as-planned spec for the Chatwoot social-messaging inbound channel — self-hosted Chatwoot as the omnichannel backend, FB/IG DMs → n8n → inboundActivity → the live pipeline, with the conversation embedded inside the CRM. Replaces Respond.io.
---

# Social intake (Chatwoot → CRM)

The social analog of [form-intake](./form-intake.md). Social DMs (Facebook +
Instagram now; WhatsApp/Telegram later) flow through a **self-hosted Chatwoot**,
which is the messaging backend. A Chatwoot webhook drives an n8n "Social Intake →
CRM" workflow that resolves platform + project + identity, dedups/creates the
Person, and writes **one `inboundActivity` per conversation**. From there the
**live lead pipeline** ([lead-pipeline](../systems/lead-pipeline.md)) produces the
Opportunity (`source = SOCIAL_DM`) and routes it for free — the pipeline is
channel-agnostic.

The differentiator vs. form-intake: managers **read and reply to the conversation
inside the CRM** (an embedded Chatwoot view), so they never switch apps. This
replaces Respond.io entirely.

> Status: **Phases 0–3 + stage-2 + Phase 5 LIVE** (2026-06-04). Infra, fork patches,
> 5 brands/10 inboxes, n8n intake → pipeline → Opportunity, Person-merge, and the
> **in-CRM native chat panel** (read/reply on Opportunity + Person, on-claim
> assignment) — all verified. PRs #3–#12 on `main`. Only App Review (public DMs)
> deferred. See the Phase-5 as-built below + `docs/PHASE5_GATES.md` (boot/deploy
> lessons).
>
> **As-built (live):**
> - Self-hosted Chatwoot on Railway project **`enso-chatwoot`**
>   (`6f2f50fd-1f6e-4a45-ad34-a8a5f9141b1b`): `chatwoot-web` (`4295ecaa…`, Puma
>   :3000) + `chatwoot-worker` (`b6a992fa…`, Sidekiq) + Postgres (`70d51b73…`) +
>   Redis (`ec0a6d52…`). Serving at **https://chat.enso.ro** (custom domain,
>   targetPort 3000, DNS CNAME → `2hh9zkhv.up.railway.app`).
> - Built from fork **`corporateready/chatwoot@enso-production`** (off v4.14.1);
>   push auto-deploys both services. `preDeployCommand = rails db:chatwoot_prepare`.
>   DB seeded (101 installation_configs); super-admin + account 1 created.
> - **Phase 1 fork patches:** referral capture (`423af00`) + iframe embedding
>   (`cc40974`, Rack middleware gated on `ENSO_FRAME_ANCESTORS=https://crm.enso.ro`)
>   + Dockerfile `.git_sha` fix (`2ef5563`). Verified: chat.enso.ro has no
>   `X-Frame-Options`, `CSP: frame-ancestors 'self' https://crm.enso.ro`.
> - Creds in repo `.env` (`CHATWOOT_BASE_URL`/`ACCOUNT_ID=1`/`API_TOKEN`, working).
>   `FORCE_SSL` still `false`. Railway ops via CLI (token auto-refresh) or GraphQL
>   API (CLI token + `User-Agent` header); **GitHub-repo connect + custom-domain
>   creation need the dashboard** — the CLI token isn't scoped for them.

## Decisions (settled)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Human-only, no AI auto-reply** (this phase) | A human manager replies; "chatbot" = the social pipeline, not an AI agent. AI greet/qualify is a separate, later build. |
| D2 | **Chatwoot is the omnichannel layer** | Chatwoot already normalizes FB/IG/WhatsApp/Telegram into one model + one webhook + one API. Our CRM side talks only to Chatwoot → adding a channel never touches n8n/pipeline/embed. |
| D3 | **One Meta app** hosts Messenger + Instagram (+ later WhatsApp Cloud API) | Self-owned, fee-light, no middleman. Business Verification/setup amortized across 3 channels. BSP kept only as a WhatsApp-ops option or App-Review escape hatch. |
| D4 | **Deploy fresh Chatwoot on Railway** (our fork) | Need fork control for the two patches below. |
| D5 | **Patch the Chatwoot fork to capture Meta ad referral** | Chatwoot's Meta parser silently drops the `referral` object — without a patch, ad attribution is unreachable. |
| D6 | **Embed via iframe + invisible SSO**, CRM-only | Fast, full-feature; the iframe *is* the full Chatwoot conversation UI. Managers ideally never open Chatwoot directly. |
| D7 | **CRM drives assignment**, pushed into Chatwoot | Chatwoot auto-assignment OFF; the existing routing/claim pipeline picks the owner and pushes it into Chatwoot. One source of truth. |
| D8 | **`crm.enso.ro` + `chat.enso.ro`** (shared parent domain) | Same-site so Chatwoot's `SameSite=Lax` session cookie works inside the CRM iframe. |
| D9 | **Route iff a project is resolved**; else activity-only | Ads (ref → project) and brand/umbrella inboxes route immediately; organic on the unknown bucket logs an activity for triage with no Opportunity/ping. |
| D10 | Map managers → Chatwoot agents **by email** | Reuse the existing roster; no separate mapping table. |

## Architecture

```
Meta CTM/IG ads (marketing sets ref=proj+utm…) + organic DMs
        │
        ▼
chat.enso.ro  ← Chatwoot on Railway (OUR fork; v4.1+)
   • PATCH 1: persists Meta referral (ref/ad_id/ads_context) → conversation.additional_attributes
   • PATCH 2: X-Frame-Options/CSP frame-ancestors allows framing by crm.enso.ro
   • auto-assignment OFF on every inbox
   • inboxes: FB + IG for each of the 5 pages (Instagram Business Login path)
        │ webhook (conversation_created / message_created, secret-in-path)
        ▼
n8n "Social Intake → CRM"  (clone of Form Intake → CRM)
   • resolve: platform (inbox channel) + project (inbox map + ref override) + identity
   • parse referral → organic vs ads (reuse legacy two-tier resolver)
   • dedup/create Person; ONE inboundActivity per conversation (idempotency key = chatwootConversationId)
   • route-iff-project-resolved (D9): ads/brand/umbrella → route; organic-unknown → activity-only
        │
        ▼
LIVE pipeline (unchanged): Opportunity (source SOCIAL_DM) → routing → claim
        │ on claim
        ▼
CRM hook pushes conversation assignment INTO Chatwoot (mapped agent, via API)
        │
        ▼
crm.enso.ro → manager opens the deal → Twenty tab with iframe:
   server mints 5-min SSO URL for the mapped agent → deep-links to the conversation
   → manager reads & replies in-CRM (Chatwoot never opened directly)
```

## Channels & inbox → project map

Each Facebook page and each Instagram account is its own Chatwoot inbox; the join
key in Chatwoot's webhook/API is **`inbox_id`** (organic page identity). Instagram
uses the **Instagram Business Login** path (Chatwoot v4.1+); the legacy
"Instagram via Facebook Login" is deprecated.

| Chatwoot inbox | Channels | Default project | code | Project resolution |
|---|---|---|---|---|
| ENSO Development **Moldova** | FB + IG | ENSO ESTATE (MD) | ENS2502 | umbrella — ad `ref` can sharpen to a more specific MD project |
| ENSO Development **Romania** | FB + IG | ENSO LIVING (RO) | ENS2501 | umbrella — ad `ref` can sharpen |
| ARTIMA Business & Lifestyle | FB + IG | ARTIMA | ENS2301 | brand — fixed |
| AVRAM IANCU | FB + IG | AVRAM IANCU | ENS2402 | brand — fixed |
| VANZARI IMOBILIARE | FB + IG | **unknown → ENSVI** | ENSVI | general bucket — project decided in conversation; ad `ref` routes correctly from the start |

No social inbox for TRIUMF BOTANICA (ENS2101) or the ENSO Development umbrella
record (ENS00). WhatsApp/Telegram inboxes added later under the same model.

## Organic vs ads attribution

Two shapes, exactly as the legacy Respond.io flow modeled:

- **Organic** — no referral. Project comes from the inbox (`inbox_id` → map above).
  On the umbrella inboxes that's the country default; on Vanzari it's *unknown*.
- **Ads** (Click-to-Messenger / Click-to-Instagram) — Meta attaches a `referral`
  object to the first message: `ref` (our custom string), `ad_id`, `source:"ADS"`,
  and `ads_context_data`. **`ref` is our project + UTM carrier.**

### ⚠️ Chatwoot drops the referral — hence PATCH 1

Verified in Chatwoot source: `Integrations::Facebook::MessageParser` and the
Instagram builders read only sender/text/attachments and **never read
`messaging.referral` / `postback.referral`**; `additional_conversation_attributes`
is `{}`. So out of the box the ad attribution is unreachable via webhook or API
(corroborated by chatwoot/chatwoot issue #12560). **PATCH 1** extends the Meta
parser/builder to persist `referral` (`ref`, `ad_id`, `ads_context_data`) into
`conversation.additional_attributes`, so it then flows natively through the
Chatwoot webhook to n8n — mirroring how form-intake gets PostHog data.

To receive the referral on the `messages` event, the page must subscribe to both
`messages` and **`messaging_referrals`** webhook fields.

### The `ref` scheme (hand to the marketing team)

We control ad creation, so the digital-marketing team sets each CTM/CTD ad's
**`ref`** to a URL-encoded query string carrying an explicit project code plus the
standard UTMs:

```
proj=ENS2502&utm_source=facebook&utm_medium=paid_social&utm_campaign=<campaign>&utm_content=<ad>&utm_term=<adset>
```

n8n resolution order for the project:
1. `ref.proj` (explicit code) — authoritative; overrides the inbox default.
2. else campaign-name/`ad_id` regex (legacy two-tier fallback).
3. else the inbox default (umbrella country project / brand).
4. else *unknown* (Vanzari organic) → activity-only per D9.

UTMs from `ref` populate the `inboundActivity` attribution fields exactly like the
form channel, and the pipeline freezes them onto the Opportunity's first-touch
snapshot.

## Identity resolution

Dedup the Person by **phone → email → social handle**, in that order (drop the
legacy name-match — too loose). Chatwoot's contact carries phone/email/identifier
+ the platform handle. Phone normalization reuses the form-intake length rule
(8→`+373` MD, 9→`+40` RO). The social handle/id is stored on the
`inboundActivity` (`externalId` / `distinctId`); a dedicated Person social-handle
field is optional and can be added later if needed for matching.

## Conversation granularity / dedup

**One `inboundActivity` per Chatwoot conversation.** Create on
`conversation_created` (or first inbound `message_created`), using
**`chatwootConversationId` as the idempotency key** — skip if an activity with
that id already exists. Later messages in the same conversation do **not** create
new activities or deals; the pipeline's person×project open-deal dedup handles
deal-level idempotency. `externalThreadId` stores the platform thread id.

## The embedded agent experience (iframe + SSO)

Verified against Chatwoot source. Self-hosted only (Platform APIs aren't on
Chatwoot Cloud).

- **SSO mint:** `GET /platform/api/v1/users/{id}/login` (auth header
  `api_access_token` = the **Platform App** token, created in the super-admin
  portal). Returns `{ "url": "<FRONTEND_URL>/app/login?email=…&sso_auth_token=…" }`.
  The token is **5-min TTL, single-use** → mint server-side at the moment of iframe
  render; never cache.
- **Deep-link is two-step:** the SSO URL establishes the session at `FRONTEND_URL`,
  then navigate the iframe to `/app/accounts/{accountId}/conversations/{conversationId}`.
  Store `chatwootConversationId` on the activity/opportunity to build the link.
- **PATCH 2 (X-Frame-Options/CSP):** Rails ships `X-Frame-Options: SAMEORIGIN` by
  default and Chatwoot exposes **no env toggle**. An initializer must delete it and
  set CSP `frame-ancestors 'self' https://crm.enso.ro`.
- **Cookies (why D8):** the session cookie is `SameSite=Lax`, which is **not sent
  in a cross-site iframe** → login loop. Hosting Chatwoot on `chat.enso.ro` (same
  parent as `crm.enso.ro`) keeps it same-site so `Lax` works. (The `SameSite=None;
  Secure` alternative is fragile under third-party-cookie blocking — avoided.)
- **ActionCable:** `FRONTEND_URL` and the websocket origin must match the host the
  iframe loads; the proxy must allow WS upgrade — common cause of "logged in but
  stuck."

## Assignment push-back + agent provisioning

- **Provisioning:** create a Chatwoot agent per manager via the Platform API
  (`POST /platform/api/v1/users`, then `POST …/accounts/{id}/account_users` with
  role `agent`); add inbox membership via the Application API
  (`POST /api/v1/accounts/{id}/inbox_members`). Map to `workspaceMember` **by
  email** (D10). Account membership is mandatory or the SSO'd dashboard hangs.
- **Push-back:** a new enso server hook — on claim (deal leaves ROUTING with an
  owner), assign the Chatwoot conversation to the mapped agent via the Chatwoot
  API. Chatwoot auto-assignment stays OFF so the CRM is the single source of truth.

## `inboundActivity` mapping

The object is already social-ready (no rebuild). Per conversation, write:
`kind = SOCIAL_MESSAGE`, `source = CHATWOOT`, `platform`
(INSTAGRAM/FACEBOOK/…from the inbox channel type), `chatwootConversationId`,
`externalThreadId`, `body`, `person`, `project` (or null when unresolved),
`externalId`/`distinctId` (social id/handle), attribution (`utm*`, landingPage =
n/a), `submittedPayload` (the raw Chatwoot conversation payload as the safety net),
`isSynthetic` (test/junk flag). The pipeline maps `kind = SOCIAL_MESSAGE →
opportunity.source = SOCIAL_DM`.

## Consent

Inbound social message = implied consent **for that channel** (per-project, source
`CHATWOOT`). On a resolved person×project, upsert `personProjectConsent` for the
messaged channel (e.g. `whatsapp`/`instagram`/`facebook` flag as the model allows).
Enforcement stays `!doNotContact && consent`. Mirrors form-intake's
implied/opt-out model.

## Meta app setup (Business-Manager admin)

**Key finding:** for assets you **own or manage**, Meta grants **Standard Access**
— *"Advanced Access is needed if your app serves accounts you don't own or manage,
while Standard Access suffices for accounts you own or have added to your App
Dashboard."* So the demo-video **App Review is likely NOT required** for our own
5+5 assets. **Business Verification is already DONE** (the agency BM is verified —
confirmed 2026-05-31), which removes the only multi-day external dependency; the
path is now gated solely by our own build pace. *(Treat "zero App Review" as
verify-in-practice during the smoke test; Chatwoot's own docs still phrase it for
the multi-tenant default.)*

### Pages under different businesses (agency model)

Pages owned by **different** businesses are fine **if** they're assigned to the one
agency Business Manager (owned or via **partner/agency access**) and the connecting
admin manages them — Meta counts managed-via-partner-access as "manage," so
Standard Access still applies. Requirements:
1. **Consolidate** every page + its IG account under the single agency BM; the
   **app lives in that BM**, and that BM is the one verified.
2. **One connecting admin** (a person or a System User) with admin on *all* pages,
   so a single Chatwoot OAuth grant attaches them all.
3. **Fragility:** if a client revokes the agency's partner access, that inbox
   breaks; and a cross-owned asset *could* be flagged as needing Advanced Access —
   another verify-in-smoke-test item, with App Review (routine on a verified BM) as
   the fallback.

### Checklist (⏳ = long-lead)

1. **✅ Business Verification — DONE** (agency BM verified, 2026-05-31). No wait.
2. Assign all 5 Pages + 5 IG pro accounts to the **agency BM** (own or partner
   access); create a **Business-type** Meta app under it.
3. Add admins/devs + **Instagram Tester** roles for pre-prod testing (full pipeline
   is testable in Development mode with role-holders).
4. **Messenger:** add Facebook Login + Messenger products; allow `https://chat.enso.ro`
   as OAuth domain; webhook → `https://chat.enso.ro/bot`, verify token =
   `FB_VERIFY_TOKEN`; subscribe `messages, messaging_postbacks, messaging_referrals,
   message_echoes, message_deliveries, message_reads`. *(`messaging_referrals` feeds
   PATCH 1.)* Permissions: `pages_messaging, pages_manage_metadata, pages_show_list,
   pages_read_engagement, business_management`.
5. **Instagram (Business Login, v4.1+):** add Instagram product; set
   `INSTAGRAM_APP_ID/SECRET/VERIFY_TOKEN` (distinct from the FB app id) + enter at
   `/super_admin/app_config?config=instagram`; webhook →
   `https://chat.enso.ro/webhooks/instagram`; redirect →
   `https://chat.enso.ro/instagram/callback`; subscribe `messages, messaging_seen,
   message_reactions`; permissions `instagram_business_basic,
   instagram_business_manage_messages`.
6. Set app **Live** (required for IG webhooks; only own/added assets connected).
7. Create the FB + IG inboxes in Chatwoot via the Login flows; attach assets;
   **disable auto-assignment** on every inbox.
8. **⏳ WhatsApp (later):** add WhatsApp product, WABA + number, display-name
   approval — its own long-lead items.

## Infra (Railway)

- New Railway service set in (or alongside) the existing projects: **Chatwoot**
  (Rails app + Sidekiq worker) + **Postgres** + **Redis**, built from our Chatwoot
  fork (for PATCH 1/2). Mirror the twenty-worker lesson — ensure Railway builds
  *our* image, not the upstream one.
- **DNS (we control `enso.ro`):** `crm.enso.ro` → twenty-server, `chat.enso.ro` →
  Chatwoot; Railway custom domains + TLS. Moving the CRM to `crm.enso.ro` is a small
  migration off the `*.up.railway.app` host.
- Chatwoot env: `FRONTEND_URL=https://chat.enso.ro`, `FORCE_SSL=true`, secret key
  base, the Meta app vars above. n8n webhook auth = secret-in-path (Chatwoot
  webhooks can't send custom auth headers), analogous to form-intake's
  `x-intake-secret`.

## Phased plan

| Phase | What | Risk |
|---|---|---|
| **0 · Infra** | Deploy Chatwoot (app+worker+PG+Redis) on Railway from our fork; DNS `crm.`/`chat.enso.ro` + TLS. | DNS/migration; ensure our image builds. |
| **1 · Fork patches** | PATCH 1 (referral capture) + PATCH 2 (X-Frame/CSP). | Second fork to carry across upgrades. |
| **2 · Channels** | Meta app (1 app, Messenger + IG products); connect 5 FB + 5 IG inboxes; auto-assign OFF. | Agency-access consolidation; verify Standard Access. (Business Verification ✅ done.) |
| **3 · n8n intake** | Clone Form Intake → Social Intake; webhook → resolve (platform/project/identity + ref parse) → one inboundActivity/conversation; route-iff-project (D9). | Low — mirrors a proven workflow. |
| **4 · Assignment push-back** | Provision agents (email map); on-claim hook assigns the Chatwoot conversation. | Low–med. |
| **5 · Embedded UI** | Twenty tab on the deal: server mints SSO URL → iframe → deep-link. Validate cookie/CSP/WS end-to-end. | Med — the iframe behavior. |
| **6 · Triage + verify** | CRM view of project-less SOCIAL_MESSAGE activities; smoke-test FB+IG (organic + ads), dedup, claim→assign→reply-in-CRM; clean up test records. | Low. |

The Opportunity + routing between phases 3 and 4 is **already shipped**.

## Out of scope (this phase)

- **AI auto-reply / qualification bot** — humans reply (D1). A later layer.
- **WhatsApp** — same Meta app hosts it (Cloud API) or a BSP (360dialog) for ops;
  deferred until a WhatsApp Business number is provided.
- **Telegram** (trivial bot token) / **TikTok DMs** (no general business DM API
  today) — future channels; the pipeline is already channel-agnostic.
- **Outbound cadence / templates** via Chatwoot — later.
- **Opt-out half** of consent (unsubscribe/STOP) — built with the senders.

## Open items / verify-in-practice

- **Standard Access vs App Review** for own + agency-managed assets — confirm during
  the smoke test before go-live.
- **Chatwoot v4.1.x Instagram-inbox bugs** (chatwoot issues #11577/#11578/#12275) —
  QA on the pinned version.
- **PATCH 1/2 upgrade cost** — track against Chatwoot releases.
- **Person social-handle field** — add only if handle-based dedup proves necessary.
- **`ref` adoption** — depends on the marketing team setting the agreed string on
  every ad; organic-on-umbrella still resolves via the inbox default.

## As-built — Phases 2–3 + stage-2 (2026-06-03)

**Meta app** "ENSO Chatwoot" (App ID `1372861104654929`) under BM **ENSO
Development Moldova** (verified). Messenger + Instagram (Instagram-Login) use
cases. Webhooks: Messenger `…/bot`, Instagram `…/webhooks/instagram`; verify
tokens `enso-fb-…` / `enso-ig-…`. **Meta creds live in Chatwoot super-admin**
(`/super_admin/app_config?config=facebook` & `?config=instagram`), **NOT Railway
ENV** — `GlobalConfigService` reads the DB `InstallationConfig` first and the seed
pre-creates blank rows, so ENV is shadowed (its `first_or_create` ENV-fallback
returns the existing blank). Set FB_APP_ID/SECRET/VERIFY_TOKEN +
INSTAGRAM_APP_ID/SECRET/VERIFY_TOKEN there.
- **Dev-mode gotchas:** Facebook delivers tester DMs in Development; **Instagram
  requires the app PUBLISHED/Live** to deliver webhooks at all. Sender must be an
  **app role** (admin/tester) until App Review. IG sender ≠ receiver (can't DM
  self) → use a second tester IG account. **App Review (`pages_messaging`,
  `instagram_business_manage_messages`) is required to receive *public* DMs** —
  the go-live gate (Meta's own UI confirms; the earlier "Standard-Access, no
  review" hope was wrong for messaging).

**Inboxes (Chatwoot account 1), auto-assignment OFF on all:**

| inbox_id | channel | name | page_id | → project (UUID) |
|---|---|---|---|---|
| 1 / 2 | FB / IG | Artima | `104832627735882` | ARTIMA `4b63d540-…` |
| 3 / 6 | FB / IG | ENSO Development Moldova | `824873130700445` | ENSO ESTATE `2b0b2f11-…` (MD default) |
| 4 / 5 | FB / IG | Vânzări Imobiliare | `585329244673786` | **null** (unknown bucket; ENSVI `153c97f9-…` only via ref) |

Still to connect: ENSO Dev Romania → LIVING `c2fc149f-…`, AVRAM IANCU `52d75b8d-…`.
Project codes→UUIDs also: ENS2101 TRIUMF `1af69943-…`, ENS00 ENSO Dev `82e62d0d-…`.

**Stage-1 — n8n "Social Intake → CRM"** (workflow `4cJGl1W55UFDBGTw`, active).
Chatwoot **account webhook id 1** → `…/webhook/chatwoot-intake-9a992cbe851c48ac`,
subscribed to **`conversation_created` only** (deliberate: `message_created` also
fires per DM and raced the idempotency check → duplicate activities; one event
per conversation fixes it). Flow: Webhook → **Resolve** (event/channel→platform,
inbox→project + `ref.proj` override, PSID identity, referral parse, synthetic
flag, occurredAt) → **idempotency** (find inboundActivity by
`chatwootConversationId`; exists → stop) → **Find Person by PSID** (via
inboundActivity `externalId`) → create-or-reuse Person → **create inboundActivity**
(`kind=SOCIAL_MESSAGE`, `source=CHATWOOT`, platform, projectId-or-null, body,
externalId/distinctId=PSID, submittedPayload, isSynthetic). Project null → the
live pipeline skips opportunity creation (route-iff-project / D9). n8n expressions
can't use arrow-IIFEs and need spaces around ternary `?:` (else parsed as
optional-chaining). **Verified end-to-end: FB + IG → inboundActivity; idempotency;
full pipeline → Opportunity `source=SOCIAL_DM` (routing parked — ARTIMA has no
routing pool yet).**

**Paid vs organic (2026-06-05).** Resolve derives
`trafficType = (referral && (referral.source==='ADS' || referral.ad_id)) ? 'PAID'
: 'SOCIAL'` and Create writes it; the opportunity's existing
`coerceTrafficType(activity.trafficType)` then **freezes `firstTrafficType =
PAID|SOCIAL`** at origin (no CRM change). Verified live (synthetic paid → `PAID` +
parsed UTMs; organic → `SOCIAL`; test records cleaned up). ⚠️ **`trafficType` is the
only writable attribution field added** — `ad_id` / `ref` / `isPaid` are **NOT
fields on `InboundActivityCreateInput`** (a create with them → `BAD_USER_INPUT`,
which briefly broke intake during the build until reverted). The ad_id / raw ref
are retained in `submittedPayload` (the raw Chatwoot payload) for the DWH; `utm*`
are parsed from `ref` as before. Workflow backup at `/tmp/social-workflow-backup.json`.

**Stage-2 — Person merge-on-phone/email** (the legacy "Merging Contacts" analog;
the identity-merge the CRM lacked). **Deployed + VERIFIED live** (2026-06-03;
commits `dcc7930c58` + `774924fa8f` + `fdd626aee5` on main). A live-test bug — the
finder read flat column names, but the workspace ORM returns composites **nested**
(`person.phones.primaryPhoneNumber`, `emails.primaryEmail`, `name.firstName`) — was
fixed in `fdd626aee5`. **Verified:** two People sharing a phone → oldest kept,
duplicate soft-deleted, the duplicate's `inboundActivity` reassigned to the keeper. ✅
Files under `packages/twenty-server/src/modules/enso/person-merge/`: POST hooks on
`person.createOne`/`updateOne` → `FindPersonDuplicatesJob` (match by `primaryEmail`
or phone **last-9** digits, excl. self/deleted) → `MergePersonDuplicatesJob` →
`PersonMergeExecutorService` (keep **oldest**; reassign person FKs on opportunity/
inboundActivity/personProjectConsent/personProjectAssignment/personRelationship;
backfill keeper's empty contact/name/company; soft-delete dups). New queue
`ensoPersonMergeQueue` (priority 4); registered in `JobsModule` +
`WorkspaceQueryHookModule`. Stage-1 dedups social by **PSID** (precise, avoids
name-collision merges); stage-2 reconciles across channels once a phone/email
appears — e.g. a manager adds a number to a name-only social Person → merges with
the form/call Person sharing it.

## As-built — Phase 5 (in-CRM chat) — LIVE + VERIFIED (2026-06-04)

Managers read & reply to the Chatwoot conversation **inside the CRM** (PRs #3–#12
on `main`, deployed on `crm.enso.ro`). The first cut used an **iframe + SSO** embed
of the Chatwoot dashboard; that worked but showed Chatwoot's whole UI and couldn't
be stripped (no chrome-free URL, cross-origin CSS blocked), so it was **replaced
with a NATIVE chat panel** — our server proxies Chatwoot's REST API (token stays
server-side) and the CRM renders the messages itself. **No iframe, no SSO, no
same-site-cookie dependency** (so `crm.enso.ro` is nice-to-have, not required for
chat; the on-claim push never needed it either).

**Server — `packages/twenty-server/src/modules/enso/chatwoot/`** (`ChatwootModule`
services; `ChatwootApiModule` hosts the controller, imported by `ModulesModule`):
- `ChatwootClientService` — axios over the **Application API** (account token
  `CHATWOOT_API_TOKEN`): agents, conversation meta, messages (read), reply
  (multipart attachments), `assignments`, `canned_responses`, attachment bytes.
  **Platform API** (`CHATWOOT_PLATFORM_TOKEN`): provision users + `GET /users/{id}`
  → the agent's own `access_token` (so replies post **attributed to the manager**).
- `ChatwootConversationResolverService` — DISTINCT conversations on a record (dedup
  by `chatwootConversationId`), **record-agnostic**: an opportunity → that deal's
  chats; a person → all their chats across deals. Enriches each with
  opportunity / project / person names + created date.
- `ChatwootMessagingService` — list/read/reply, per-record authz (the conversation
  must belong to the record), clean channel label, status + dates.
- `ChatwootAssignmentService` — **on-claim push** (wired into the
  `opportunity.updateOne` claim hook): assigns **every** conversation on the deal
  to the owner. Best-effort, account-token only.
- `ChatwootAgentProvisioningService` — managers → agents **by email** (D10), JIT +
  bulk. `ChatwootController` (`rest/enso/chatwoot`, all `NoPermissionGuard` except
  `provision-agents` = `WORKSPACE_MEMBERS`): `GET conversations|messages|canned-
  responses|attachment`, `POST reply` (multipart), `POST provision-agents`. All take
  `recordType` (opportunity|person) + `recordId`.

**Frontend** — `ChatwootConversationEmbed` (the stock `IframeWidget` delegates to
it when a widget's `configuration.url` carries the marker
`__enso_chatwoot_conversation` — a valid https URL so it passes the widget config's
`@IsUrl`; the host is never loaded). **Master-detail**: a LIST of the record's
conversations (channel · person, opportunity·project deduped, Open/Resolved status,
created + last-message dates) → click a row → the **thread** (oldest→newest,
`column-reverse` pins newest; `min-height:0` keeps the composer in view) + composer
(reply, emoji, canned responses via `/`, file/image attachments incl.
**drag-and-drop**; images fetched through an authed attachment proxy → object URL).
**Realtime:** subscribes to Chatwoot's ActionCable `RoomChannel` with the agent's
`pubsub_token` (server `GET realtime` mints cable URL + token) and refetches on
`message.*`/`conversation.*` push; polling is the **fallback** (fast 3s while the
socket is down, slow 20s safety net while it's up, gives up reconnecting after 5
tries). ⚠️ Cross-origin cable handshake (`crm.` → `chat.`) depends on Chatwoot's
`allowed_request_origins` accepting the CRM origin — if it doesn't, the socket
fails and the 3s poll carries on (pure enhancement, no regression). Mobile-friendly.

**Live workspace wiring (via page-layout REST API, not seed config):** Conversation
tab on **Opportunity** (layout `5d5457be…`, tab `bb3a88b5…`, widget `7b7e11e6…`)
and **Person** (layout `9f553d90…`, tab `5ea0a406…`, widget `5534ccff…`); icon
`IconMessageCircle`; IFRAME widget `rowSpan 10` (~620px) with the marker URL.

**Env on twenty-server:** `CHATWOOT_BASE_URL`, `CHATWOOT_ACCOUNT_ID`,
`CHATWOOT_API_TOKEN`, `CHATWOOT_PLATFORM_TOKEN` (all set).

**Verified live:** on-claim auto-assign; list→chat on both Opportunity & Person;
text/emoji/attachment replies deliver to the IG/FB thread; inline image render;
status + dates; multi-conversation per deal. Test records cleaned up.

**Lessons (see `docs/PHASE5_GATES.md`):** REST controller guards need their deps in
the controller's own module (boot-crash #3→#4); a fingerprinted/code-split bundle
means "watch the bundle hash flip" to confirm a front deploy; the conversation `id`
from the account API IS the display id used everywhere.

**Deliberately omitted:** Chatwoot assign/resolve/private-notes in the panel
(assignment is CRM-driven; deal stage tracks lifecycle).

**Phase-5 polish — added (pending live verify):** (1) **websocket push** — the
panel now subscribes to Chatwoot ActionCable (`pubsub_token`) with a poll
fallback (server: `ChatwootClientService.websocketUrl`/`getUserPubsubToken`,
`ChatwootMessagingService.getRealtimeCredentials`, `GET rest/enso/chatwoot/realtime`;
front: realtime effect in `ChatwootConversationEmbed`); verify the cross-origin
cable handshake on deploy. (2) **hide-tab-when-no-chat** — the Conversation tab
renders only when the record has a chat (server: `hasConversation` +
`GET has-conversation`; front: `useHasChatwootConversation` filters the tab in
`PageLayoutTabsRenderer`, shown in edit mode + on check error). Done **client-side
via a cheap DB-only presence check**, not a `hasChatwootConversation` field —
simpler, no metadata/migration/pipeline changes.

**Remaining:** App Review for *public* DMs (deferred — tester DMs work today);
attachment thumbnails; a DB-level dedup guard; consent upsert; phone/email dedup
in stage-1 (WhatsApp); possibly a Chatwoot-fork `allowed_request_origins` tweak if
the websocket handshake is rejected cross-origin.
