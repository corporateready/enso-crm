# Marketing Engine — Dittofeed (working spec)

Status: **working design**, converged with user 2026-06-12. This is the reference for building the marketing-engagement engine that replaces Customer.io. **Supersedes** the Novu plan in `content/docs/integrations/external-notifications.md` (kept only for the subscriber/event-mapping examples — the engine choice there is dead).

> **Scope update (2026-06-13).** **Descoped — deleted from the task list:** connection **(2) PostHog → Dittofeed** and connection **(5) dlt → BigQuery**. **Deferred — do later, not this increment:** **consent mirroring** (connection (4)'s subscription-group enforcement + unsubscribe-revoke). Permission-based sending stays the *eventual* basis; we just don't wire consent → Dittofeed yet. **Meta audiences live *inside* Dittofeed** (not a separate connection). Near-term focus: (a) the CRM→Dittofeed feed (live) and (b) **marketing-journey visibility in the CRM** — the new section below, the current build target.

## The decision (one paragraph)

Replace Customer.io with **self-hosted Dittofeed** (OSS, MIT, TypeScript — the like-for-like OSS Customer.io). **Not Novu.** Novu is notification *infrastructure*, not a marketing tool; every attempt to bolt a segment/CDP/analytics layer around it re-creates — piecemeal and worse — the things Customer.io already bundled (and re-introduces developer-gated segments, disconnected audience sync, and OLAP-as-operational latency). Dittofeed is the operational marketing engine; the **CRM stays the identity authority and primary event feed**; **PostHog** is a behavioral feed; **BigQuery** is the analytical convergence point (joint with revenue). Marketers operate Dittofeed directly.

## Principles

1. **No marketing engine inside the CRM.** The CRM *exposes* data and *emits* events; it gains zero marketing UI, objects, or campaign logic. Reading CRM data out (events, computed traits) is a feed, not an engine.
2. **The CRM is the identity authority.** The `person` UUID is the universal key — Dittofeed `userId`, PostHog `distinct_id`, everywhere. **Neither downstream tool ever does identity resolution or merging.** The CRM already does the hard work (E.164 normalization, dedup, `person-merge`); downstream just stamps the resolved UUID. This is what permanently kills the PostHog merge-hell.
3. **Two convergence points, two jobs.** **Dittofeed = operational** (data you must *react to* streams in; segments recompute in seconds). **BigQuery = analytical** (everything lands for joint-with-revenue reporting; batch is fine). Never make the warehouse do operational work — that was the composable approach's fatal smell.
4. **Permission-based only.** Send only to consented contacts. Consent is **CRM-owned** (`personProjectConsent`), mirrored into Dittofeed, enforced at send, and **unsubscribes flow back** to revoke at the source.
5. **Marketer self-serve.** Marketers build segments and journeys in Dittofeed's UI — no GitHub PR per segment change. This is the single decisive reason for Dittofeed over Novu+composable; the whole point of a marketing engine is marketing velocity.
6. **Independent enrollment, event-coupled control.** A form submit fans out into *two independent enrollments* — a sales task (existing sequencing engine) **and** a marketing journey (Dittofeed) — neither waits on the other. But the journey *listens* to CRM lifecycle events for exit/branch: reply → exit drip; closed-won → switch to onboarding; unsubscribe/unreachable → stop.

## Why Dittofeed, not Novu or PostHog (the path we walked)

- **Novu** = delivery + journeys, but **no segment builder, no campaign analytics, weak CDP.** Wrapping it in BigQuery/dbt makes segments **developer-gated** (PR per change — kills marketing velocity), **disconnects** the Meta-audience sync from the journey (can't measure its effectiveness in-funnel), and **abuses OLAP for OLTP** (segment freshness tied to dbt/dlt cadence). Novu's own dashboard cannot give marketers self-serve segments.
- **PostHog as the brain** = wrong fit. Its identity model (`distinct_id`, **irreversible** `$identify`/alias merges, web-anonymous→identified stitching) actively fights phone-first / social / externally-deduped leads. Offline leads (calls, DMs) get none of PostHog's value (no autocapture, no replay, no web funnels) and **can't even be messaged** from it (messaging is email-centric beta). Running two identity systems that must agree, one of which can be permanently corrupted, is the pain we already hit. PostHog stays a *behavioral feed*, never the identity/segment authority.
- **Dittofeed** = the OSS Customer.io: marketer self-serve segments (UI), drag-drop journeys where **audience sync is a measurable step**, and a **purpose-built operational segment store** (ClickHouse — real-time recompute, *not* redundant with BigQuery; different tier, different job). Footprint correction: **Dittofeed Lite = 4 containers** (lite app ~800 MB + Postgres + Temporal + ClickHouse); at our scale **Temporal is a single container on Postgres**, not a cluster. Real concern is project maturity (younger/smaller than Novu), not infra weight.

## Architecture

```
                          ┌─────────────────────────────────────┐
   ┌──────────────┐       │            DITTOFEED                 │
   │  TWENTY CRM  │       │        (operational engine)          │
   │  source of   │       │                                      │
   │  truth +     │═══════▶  Segment-compatible API              │
   │  identity    │ (1)   │   identify → traits                  │
   │  authority   │◀ ─ ─ ─│   track    → events                  │
   └──────────────┘ (4)   │                                      │
                          │   ClickHouse → real-time segments    │
   ┌──────────────┐       │   journeys:                          │
   │   PostHog    │──────▶│     • event entry   = instant        │
   │  behavioral  │ (2)   │     • segment entry = ~seconds       │
   └──────────────┘       │   meta-audience sync = a journey step│
                          │                                      │
   ┌──────────────┐       │   delivery: email→Resend, sms→webhook│
   │ BigQuery/1C  │──────▶│                                      │
   │ heavy traits │ (3)   └──────────────────┬───────────────────┘
   └──────────────┘                          │ (5) dlt: engagement out
                                             ▼
                                     ┌─────────────────┐
                                     │    BigQuery     │  analytical
                                     │  + Lightdash    │  convergence
                                     │ (joint w/ rev.) │
                                     └─────────────────┘
```

## The five connections

**(1) CRM → Dittofeed — the primary feed.**
A new enso server module (`enso/marketing-sync`) riding the *existing* query-hook + BullMQ pipeline (same machinery as `lead-pipeline` / `sequencing`) calls Dittofeed's Segment-compatible API. Both call types keyed on the CRM person UUID:
- **`identify`** on person create/update, consent change, project-assignment change → traits: `email`, `phone_e164`, `language`, residence/current country, `project`, `interest_level`, and per-channel consent flags. A phone-only call lead becomes an identified user with `phone` set, no email, reachable on SMS.
- **`track`** on lifecycle events → `form_submitted`, `call_received`, `social_message_received`, `stage_changed`, `reply_received`, `demo_held`, `closed_won`, `unsubscribe`. These drive **instant Event-Entry journeys**.

**(2) PostHog → Dittofeed.** PostHog Destinations/Actions forward behavioral events (pageview, pricing_viewed) to the same `track` API, keyed on the CRM UUID. Dittofeed's own segment engine then computes behavioral segments ("visited pricing ≥3× in 7d" via its *Keyed Performed* node) — **no PostHog-cohort round-trip needed**; just stream the raw events. PostHog stays the product-analytics tool.

**(3) BigQuery / 1C → Dittofeed.** Slow-moving computed traits (LTV, RFM, revenue tier) computed in the warehouse → n8n reverse-ETL → `identify` calls as traits. Batch is fine for these.

**(4) Dittofeed → CRM — the feedback loop.** Engagement comes back: **unsubscribe / hard-bounce / complaint → revoke `personProjectConsent`** (system of record), which re-mirrors out on the next sync so the two never diverge. **Replies are NOT round-tripped through the CRM** — see the reply fan-out below; Dittofeed handles exit-on-reply itself off a reply event it receives directly.

**(5) Dittofeed → BigQuery.** `dlt` exports engagement (sent/open/click/bounce/unsub/reply) to BigQuery for joint-with-revenue analytics in Lightdash/Metabase.

## Journey entry modes (the operational reactivity)

- **Event Entry = instant.** Fires the moment a matching `track` event arrives (form → Artima drip *now*). The transactional/real-time path.
- **Segment Entry = ~seconds.** Fires after segment recompute (tens of seconds — orders of magnitude faster than the daily warehouse batch the composable design forced).

## Consent loop (non-negotiable)

`personProjectConsent` (CRM) = system of record → mirrored into Dittofeed via `identify` traits → enforced at send via Dittofeed **subscription groups** → unsubscribe/bounce/complaint → **revoke at CRM** → re-mirror. The loop closes through the source of truth; it never diverges.

## Mirrored trait schema (v1)

Mirror a **curated** set — only what marketing needs to **segment** on, **personalize** with, or **gate consent** by. Dittofeed's store is operational context, not a database backup. Expected to grow; this is the v1 list (approved 2026-06-12). Every `identify` is keyed on the `person` UUID.

| Copy IN (traits Dittofeed gets) | Leave OUT (stays CRM-only) |
|---|---|
| `first_name`, `email`, `phone_e164`, `language` — personalize + reach | internal IDs, audit fields (`createdBy`, etc.) |
| `current_country`, `current_city` — geo segments | sales notes / call transcripts |
| `project`, `interest_level` — core segment axes | financial / contract details |
| deal `stage`, `first_touch_at`, `last_touch_at` — lifecycle segments | manager-assignment internals |
| `email` / `sms` / `whatsapp` / `call` consent flags — **the send gates** | anything not used to segment, personalize, or gate |
| aggregates: `last_email_opened_at`, `total_emails_sent` | raw per-event history (lives in BigQuery) |

## Deliverability / sending identity (multi-brand)

- **Email via Resend, one shared stack, per-domain authentication.** The unit of email auth (DKIM/DMARC) is the **domain**, not the Workspace or mailbox — so every brand domain you send `From` is independently verified in Resend: `enso.ro`, `artima.md`, `ioanaradu.md`, … each with its own sending subdomain (`mail.<brand>`, DKIM + Return-Path). One Resend account + one Dittofeed serves all brands; only the DNS records are per-domain.
- **`From` matches the brand the lead engaged with** — an `ioanaradu.md` lead gets mail from `sergiu@ioanaradu.md`, an Artima lead from `oleg@artima.md`. Cross-brand sending (e.g. an `ioanaradu.md` lead from `enso.ro`) reads as spoofing to the recipient *and* fails DMARC — brand-matched From is both correct and required. Each brand domain warms its own reputation (isolation is a feature; budget a short independent warmup per domain).
- **One-click `List-Unsubscribe` (RFC 8058) → CRM consent revoke.** This is connection (4) for email.
- **Volume tier: under ~5k/day to Gmail.** Below the bulk-sender threshold, so SPF/DKIM/DMARC + unsubscribe are required but warmup is gentle and compliance is light. Re-tier if volume grows.
- **Workspace note:** most brand domains are secondary domains on the enso.ro-primary Google Workspace; Artima is a separate Workspace. This matters for *receiving* replies, **not** for sending — sending is Resend, per-domain.

## Reply handling — exit fires off `inboundActivity` (decided 2026-06-12)

Exit-on-reply sources from the **`inboundActivity`**, not from Chatwoot directly. When an inbound reply lands as an `inboundActivity`, `enso/marketing-sync` fires `track('reply_received', {userId: person.id})` → Dittofeed exits any waiting drip. This is just one more event on connection (1)'s existing emitter — no n8n splitter, no Gmail forward, no Dittofeed inbound-parse (the earlier "fan-out" is dropped).

Why `inboundActivity` over pulling from Chatwoot:
- **Identity already resolved** — `inboundActivity.personId` *is* the Dittofeed `userId`; pulling from Chatwoot would re-resolve contact→person and risk divergence.
- **Zero new infra** — `reply_received` is already a connection-(1) `track` event on the machinery we're already building.
- **One source of truth** — sales advance and drip exit key off the *same* record; they can't disagree that a reply happened.
- **Channel-agnostic** — email reply / social DM / SMS-back all normalize into `inboundActivity` with `kind`/`source`.
- **Over-firing is harmless** — fire on every inbound reply; Dittofeed no-ops if the person isn't in a waiting drip, so no filtering needed.

**Boundary with the Chatwoot / email-channel session:** that session still owns one thing it needs anyway — making an **email reply become an `inboundActivity`** (the `incoming_email` kind + email intake route, a known email-channel gap). Once a reply is an `inboundActivity`, the exit is ours and trivial. That's the *only* cross-session dependency.

## SMS channel

- **Provider: [sms.md](https://sms.md/)** via Dittofeed's **webhook delivery channel** (sms.md isn't a built-in Dittofeed provider; the SMS step POSTs to its REST API). Direct MD-operator connections (Moldcell/Orange/Unite), ~0.30 MDL/SMS domestic.
- **Delivery receipts** (sms.md webhook) → engagement feedback. **STOP/opt-out** → revoke the SMS channel in `personProjectConsent`, same loop as email unsubscribe.
- **International is deferred (low probability).** sms.md gates international behind a support request (no public rate). If non-MD volume ever appears, route by country — MD → sms.md, non-MD → Twilio (~$0.04/msg) — via Dittofeed's channel logic. Not v1.

## Ad audiences (Meta)

Meta Custom Audience sync becomes a **step inside the journey** (add/remove members), so retargeting is measured as part of the campaign funnel — the capability the disconnected n8n job lacked. Replaces the existing `Customer.io Audience → Facebook` n8n workflow (repoint source from Customer.io to the Dittofeed segment, or keep n8n reading the Dittofeed segment if a journey step proves limiting). Meta sync is push-only by nature (no member-level readback).

## Analytics (two tiers)

- **In-tool / operational:** Dittofeed's built-in journey + broadcast analytics (per-step funnel, deliverability) for "is this campaign working" glances.
- **Joint / deep:** `dlt` Dittofeed → BigQuery, joined against deals/revenue/1C, surfaced in Lightdash/Metabase — marketing performance next to the rest of the business (the de-siloing Customer.io never allowed).

## Relationship to the sales-sequencing engine

**Independent engines, shared substrate.** Sales sequencing (`enso/sequencing`, live) creates *manager tasks* for claimed deals; marketing (Dittofeed) sends *automated messages* to segments. They share `person` / consent / the UUID. Coordination = **suppression**: marketing should not blast a contact in an active sales cadence (and the journey exits on the same reply that advances the sales deal). No unification — the shapes are too different and the live sequencing engine must not be destabilized.

## Marketing-journey visibility in the CRM (spec — 2026-06-13, for review)

**Goal.** On a Person (and optionally an Opportunity), a sales manager sees: which marketing journeys the person **has been in** and **is in now**, **at what step**, the messages they've **already received** (with delivered/opened/clicked), and — phase 2 — **when the next messages are due**. The "a brand-new person has never been in any journey" fact falls out for free (no enrollment rows yet).

### What Dittofeed actually gives us (verified against its docs, 2026-06-13)

| Need | Dittofeed mechanism | |
|---|---|---|
| Push state out as it happens | **Webhook-channel Message node** — a journey step that POSTs arbitrary JSON to a URL (the same channel we use for sms.md) | ✅ |
| Read current segment membership | `POST /api/admin/users` (filter by `userIds`) → `segments[]`, `properties`, `subscriptions` | ✅ |
| Read message history per person | `GET /api/admin/deliveries?userId=` → channel, `journeyId`, `templateId`, status, `sentAt` | ✅ |
| Live journey position / current step | — | ❌ no API |
| Scheduled / upcoming sends | — | ❌ no API |

Journey node types are fixed: **Entry, Message, Wait-For, Delay, Exit, Segment-Split** — there is *no* add-to-segment node and *no* dedicated webhook node (the Webhook is a **message channel**). The two ❌ are the crux: **Dittofeed will not answer "in step 2 of ARTIMA intro," so the CRM must record journey position itself.** We capture milestones as they happen (push) and, for phase 2, compute upcoming sends from the cadence *we* author.

### Mechanism — push, not poll

Each journey carries **Webhook-channel Message nodes** at its milestones (right after Entry; after each email; right before Exit). Each POSTs, per user, to a new CRM endpoint:

```
POST {CRM}/rest/enso/marketing/journey-callback
x-enso-marketing-secret: <DITTOFEED_CALLBACK_SECRET>
{ "workspaceId": "<enso ws id>", "userId": "<person UUID>",
  "journey": "ARTIMA_INTRO", "step": "email_2_sent",
  "status": "ACTIVE", "occurredAt": "2026-06-13T..." }
```

`userId` is already the CRM person UUID (connection-(1) invariant) — no resolution, no merge risk.

### CRM side — three pieces

1. **New object `marketingEnrollment`** (provisioned by an *idempotent metadata script*, same pattern as `packages/twenty-server/scripts/provision-opportunity-client-type.mjs` and the company-enrichment fields):
   - `person` (relation), `journey` (TEXT key), `status` (SELECT: `ACTIVE`/`FINISHED`/`EXITED`), `currentStep` (TEXT), `enteredAt` + `lastEventAt` (DATE_TIME), `dittofeedJourneyId` (TEXT — correlates to the deliveries API), phase-2 `nextExpectedAt` (DATE_TIME).
   - Upserted on (`person`, `journey`); the row **is** the per-person journey state, and is the CRM-visible enrollment guard.

2. **New public callback endpoint** `@Controller('rest/enso/marketing')` → `@Post('journey-callback')`.
   - **⚠ New pattern flag:** every existing enso controller (e.g. `ChatwootController`) is `JwtAuthGuard`-protected (logged-in user, workspace derived from the JWT). This one is **machine-to-machine with no JWT** — so it is guarded by a **constant-time shared-secret header** (`DITTOFEED_CALLBACK_SECRET`) and takes `workspaceId` **in the body** (no auth context to derive it from). Reject on bad secret / unknown workspace / unknown person.
   - Validates → upserts `marketingEnrollment` via the workspace ORM → writes a timeline sentence.

3. **Timeline surface (free, immediate):** the callback also writes an `enso-event.marketing_*` row via `buildEnsoTimelineInserts` ("Entered ARTIMA intro sequence — by ENSO CRM", "Received intro email 2 of 3", "Completed ARTIMA intro"). Reuses the existing green-sentence renderer (`ENSO_EVENT_ACTIVITY_NAME_PREFIX`) → managers see journey activity on the person/opportunity timeline with **zero frontend work**, before the full widget exists.

### Manager widget (twenty-front Person tab) — the "sales/marketing cloud" view

- **Journeys been-in / in-now** from `marketingEnrollment` rows (status + current step + entered date), expandable per journey.
- **Messages received** via a CRM **proxy** endpoint → `GET /api/admin/deliveries?userId=` (channel, template, delivered/opened/clicked, sentAt). **Proxied server-side** — the Dittofeed Admin API key never reaches the browser (same containment as the Chatwoot controller proxying the account token).
- **Phase 2 — upcoming + timing:** mirror each journey's cadence in the CRM (we author the journeys, so `email1 → +2d → email2 → +3d → email3` is known) and compute `nextExpectedAt` from `currentStep + enteredAt`. This is explicitly **not** a Dittofeed query (none exists); ship it once a journey's cadence is stable.

### Enrollment idempotency

Dittofeed de-dups journey entry natively; an entry **Segment-Split** ("first `deal_created` AND not already enrolled") is belt-and-suspenders. The `ACTIVE` `marketingEnrollment` row is the CRM-visible guard. **No CRM→Dittofeed polling is needed** for the guard.

### New config (secrets set by the user — never the agent)

- `DITTOFEED_ADMIN_API_URL` + `DITTOFEED_ADMIN_API_KEY` — server-side, for the deliveries/users proxy (the **Admin API**, distinct from the public Write Key already set for connection (1)).
- `DITTOFEED_CALLBACK_SECRET` — shared secret for the inbound journey-callback.
- `ENSO_MARKETING_WORKSPACE_ID` — to resolve the workspace in the unauthenticated callback (or carry it in the body).

### Effort split

- **Tier A (proves the loop):** `marketingEnrollment` object (metadata script) + callback endpoint + timeline rows + per-journey Webhook-channel nodes. Backend + a bit of manual journey wiring.
- **Tier B (the widget):** twenty-front Person tab + the deliveries proxy.
- **Phase 2:** the cadence mirror for upcoming-send timing.

### Resolved (2026-06-13)

1. **Both** — `marketingEnrollment` object (structured/queryable state + the widget) **and** timeline green-sentences (instant readability).
2. **Per-step callbacks.** Crucial point on *why* this isn't redundant with "knowing position": **there is no API to query position — the per-step webhook callback is the only way we learn it.** Dittofeed pushes "reached step X" as it happens; the stored `currentStep` **is** our knowledge of where the person is. Enter/exit-only → we'd know "in/done" but not which email; per-step → "email 2 of 3, sent yesterday." A Webhook-channel Message node is dropped after each meaningful step (each email / wait completion / branch).
3. **Consent mirroring = deferred (do later), not descoped.** Permission-based sending stays the eventual basis; the subscription-group enforcement + unsubscribe→`personProjectConsent` revoke loop is built in a later increment, not this one.

## Build steps (phased)

1. **Deploy Dittofeed Lite on Railway — ✅ DONE 2026-06-12.** Official `dittofeed` template into new project **enso-marketing** (`f5f87f92-1e10-4491-a61d-0d2d897923ee`, personal workspace). 4 services SUCCESS: Dittofeed `dittofeed-lite:v0.22.0`, Postgres, ClickHouse, Temporal. Dashboard live at **https://dittofeed-production-4624.up.railway.app/dashboard** (single-tenant; admin login = `PASSWORD` service var). Template auto-generated `PASSWORD`/`SECRET_KEY` and wired DB/ClickHouse/Temporal. Blob storage enabled (`ENABLE_BLOB_STORAGE=true` + `BLOB_STORAGE_*`) → Railway bucket **dittofeed-blob** (region ams/EU-West) for attachments + view-in-browser (inline images via URL until Dittofeed ships image hosting). `BOOTSTRAP=false` after first boot. `SESSION_COOKIE_SECURE=true` set (fixes the single-tenant insecure-cookie warning, since the Railway domain is TLS). **Data residency: all-EU confirmed** — all 4 services in `europe-west4-drams3a` (Netherlands), bucket in Amsterdam (ams). Duplicate project cleaned up. Remaining watch: Next.js `standalone`/`newNextLinkBehavior` warnings are cosmetic (baked into lite image). Ops gotcha: Railway API returned transport timeouts on mutations that still landed server-side — always verify-after-each-write; WebFetch also caches pages 15 min, so verify dashboard state via curl/browser not WebFetch.
2. **Sender setup — 🟡 IN PROGRESS 2026-06-12.** Resend ("ENSO Development" account) connected to Dittofeed: created Sending-access API key "Dittofeed Marketing" (all-domains), pasted into Dittofeed Settings → Email channel, set **Resend as default provider**, default From `Oleg <oleg@notifications.enso.ro>`. **Test send to `dvasiliev@enso.ro` = Delivered** (verified in Resend Emails log) — full chain Dittofeed→Resend→inbox proven. Interim: using the already-verified **`notifications.enso.ro`** subdomain. **Later:** add root domains `enso.ro`/`artima.md`/`ioanaradu.md` in Resend → brand-matched personal From (`oleg@enso.ro` etc.). **Webhook configured:** Resend webhook → `https://dittofeed-production-4624.up.railway.app/api/public/webhooks/resend`, **Enabled**, 6 events (sent/delivered/opened/clicked/bounced/complained); signing secret pasted into Dittofeed Settings → Resend → Webhook Key by user. ⚠️ **Event flow NOT yet positively verified** — Dittofeed *test-message* sends don't create tracked Delivery records and Resend's webhook event log didn't surface in-UI during setup, so the webhook→Dittofeed leg (incl. signing-secret correctness) will self-confirm on the **first real journey/broadcast send** (Delivery status should advance Sent→Delivered/Opened). Verify then. Note: Resend's quota is *transactional* volume and Dittofeed sends via the transactional API, so marketing counts against it — if volume grows materially, Amazon SES (~$0.10/1k, supported by Dittofeed) is ~10× cheaper and a swappable provider. Credentials (API key, webhook secret, dashboard password) entered by the user — agent never handles them.
3. **`enso/marketing-sync` module — 🟡 IN PROGRESS 2026-06-12.** Increment 1 written (CRM→Dittofeed, `userId` = person UUID): event-bus listener (`@OnDatabaseBatchEvent`, fires on GraphQL *and* raw-ORM writes) → enqueues `ensoMarketingSyncQueue` → worker job → `DittofeedClientService` (`POST /api/public/apps/{identify,track}`, `Authorization: Basic <DITTOFEED_WRITE_KEY>`). Covered: **person.created/updated → identify** (curated trait set: name/email/phone-E164/city/jobTitle/companyId/createdAt; update re-syncs only when a trait field changes), **opportunity stage change → track `deal_stage_changed`** {from,to,amount}. Files under `packages/twenty-server/src/modules/enso/marketing-sync/`; wired into `modules.module.ts` (server) + `jobs.module.ts` (worker); `ensoMarketingSyncQueue` added to enum; `'dittofeed-sync'` added to `OutboundRequestSource`. Config via `process.env.DITTOFEED_API_URL` + `DITTOFEED_WRITE_KEY` (Dittofeed Public Write Key) on the enso-crm server+worker. Idempotency via messageId (`identify:<uuid>:<updatedAt>` / `track:deal_stage_changed:<oppId>:<updatedAt>`). **Validation = Railway build/deploy** (cold worktree, no local CI). Increment 2 TODO: `inboundActivity.created` → track form_submitted/inbound_message/appointment (+ reply→drip-exit), consent mirroring → subscription groups, PostHog→Dittofeed.
4. **Marketing-journey visibility in the CRM (section above).**
   - **Tier A — 🟡 CODE WRITTEN 2026-06-13.** `packages/twenty-server/src/modules/enso/marketing-sync/`: `dtos/journey-callback.input.ts`, `services/marketing-journey-callback.service.ts` (upsert `marketingEnrollment` + green-sentence timeline on person *and* source opportunity), `controllers/marketing.controller.ts` (`POST /rest/enso/marketing/journey-callback`, public via `PublicEndpointGuard`, shared-secret `x-enso-marketing-secret` constant-time compare), `marketing-callback.module.ts` (server-only, wired into `modules.module.ts`). Provisioning script `scripts/provision-marketing-enrollment.mjs`. **Pending runtime (user):** (a) run the provision script with `TWENTY_API_KEY` → creates the object; (b) redeploy so the ORM cache picks it up; (c) set `DITTOFEED_CALLBACK_SECRET` on twenty-server; (d) wire per-step Webhook-channel Message nodes into a journey (step 5).
   - **Tier B (next):** twenty-front record tab (Person **and** Opportunity — the opp tab shows enrollments for every related person) + a server-side deliveries proxy.
   - **Phase 2:** cadence-mirror for upcoming-send timing.
5. **First journey** — Artima intro drip, Event-Entry on `deal_created` (first-deal-for-person), exits on `reply_received`. Pairs with step 4 (wire the per-step callbacks into this journey).
6. **Consent mirror + enforcement + unsubscribe feedback** — subscription groups; unsubscribe → `personProjectConsent` revoke. **Deferred (2026-06-13) — later, not this increment.**
7. **Meta audience step** — *inside* Dittofeed (a journey step add/remove); repoint the n8n Customer.io→FB job to the Dittofeed segment if a journey step proves limiting.
8. ~~PostHog → Dittofeed forwarding~~ — **descoped 2026-06-13.**
9. ~~`dlt` Dittofeed → BigQuery~~ — **descoped 2026-06-13.**

## Decisions (resolved 2026-06-12)

- **Dittofeed over Novu** — marketer self-serve segments + operational (real-time) segmentation + journey-integrated audience sync; the deciding hinge (marketers genuinely build segments/journeys) is true here.
- **Self-host OSS (Dittofeed Lite) on Railway** — matches the "open source / self-host" premise.
- **CRM is the identity authority; person UUID is the universal key.** No identity resolution downstream.
- **Two-way sync (full loop)** — CRM→Dittofeed (subscribers + triggers), Dittofeed→CRM (engagement, unsubscribe, replies).
- **Independent-but-event-coupled** vs the sales-sequencing engine.
- **Multi-brand sending via Resend, per-domain DKIM** — brand-matched `From`, one shared Resend/Dittofeed stack, each brand domain (`enso.ro`/`artima.md`/`ioanaradu.md`/…) verified independently with its own `mail.<brand>` subdomain. Workspace grouping is irrelevant to sending.
- **Volume tier under ~5k/day to Gmail** — light compliance, gentle warmup (per domain).
- **Reply exit fires off `inboundActivity`** — `marketing-sync` emits `track('reply_received')` on inbound reply (identity already resolved, one source of truth, channel-agnostic, over-firing harmless). No fan-out. Only cross-session dependency: the Chatwoot session must make email replies land as `inboundActivity` (`incoming_email` kind).
- **SMS via sms.md webhook channel** for MD; international deferred (low probability), Twilio-by-country only if it ever appears.
- **Mirrored trait schema v1 locked** (table above); expected to grow.

## Still open

- **Dittofeed ops runbook** — Temporal/ClickHouse backup + upgrade path; maturity/bus-factor monitoring.
- **Meta audience: journey step vs n8n** — decide once the Dittofeed Meta integration is evaluated.
- **Which computed warehouse traits** (LTV/RFM) ship v1 vs later.
- **WhatsApp** — Chatwoot owns conversational; lifecycle WhatsApp via Dittofeed only if needed (deferred).
