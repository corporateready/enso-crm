---
title: Form intake (website → n8n → CRM)
description: The live website-form intake pipeline — each site's server route posts the lead to n8n on Railway, which dedups the person and writes an inboundActivity. PostHog is analytics only.
---

# Form intake (website → n8n → CRM)

**Status: Shipped.** Form intake is the live reference channel; it also establishes per-project marketing [consent](../systems/consent) (Terms+Privacy on the form).

Website **form submissions** go straight from each site's own server route to a
standalone n8n instance, which resolves the project, dedups the person, and
writes an `inboundActivity` into the CRM. Since **22 Oct 2026** this no longer
goes through PostHog (see [Why not PostHog](#why-not-posthog)).

This page covers **website forms only** (`FORM_SUBMISSION`). Meta Lead Ads are a
separate channel: [Lead ad intake](./lead-ad-intake).

## The path

```
Form (browser)
  └─► site server route  /api/lead   (ioanaradu.md: /api/leads)
        └─► n8n  POST /webhook/form-intake-site   (x-intake-secret)
              └─► Resolve → Dedup → Person → createInboundActivity → CRM
Form (browser, analytics consent only)
  └─► PostHog form_submitted  (no contact details; same submission_id)
```

| Site | Repo (`corporateready/…`) | Netlify project | → CRM project |
|---|---|---|---|
| sarmizegetusa.md | `sarmizegetusa` | `sarmizegetusa` | TRIUMF BOTANICA (ENS2101) |
| artima.md | `artima_chiriile` | `artima-chiriile` | ARTIMA (ENS2301) |
| enso.ro/living | `enso_living` | `enso-development` (serves enso.ro) and `enso-living` | ENSO LIVING (ENS2501) |
| ioanaradu.md | `v0-nh-buiucani` | `ioanruadu` | IOANA RADU (ENS1901) |

### The site side

Each site has `lib/submit-lead` (browser) and the lead route (server):

- **Not gated by cookie consent.** The visitor asked to be contacted; delivering
  their details doesn't need cookie consent. Only cookie-based identifiers
  (`_fbp`, `_fbc`, `roistat_visit` with marketing consent; PostHog `distinct_id`
  with analytics consent) depend on it.
- **Thank-you only after delivery.** The form waits for the route; on failure it
  stays filled and shows an error, so a lead is never lost behind a thank-you.
- **One `submission_id` per lead**, reused on retry. It is also the Meta pixel
  `eventID` and PostHog's `form_submitted_event_id`.
- The route validates (name + phone or email), drops bots via a hidden
  spam-trap field, rate-limits per IP (best effort), adds `ip`, `user_agent` and
  the visitor's location from Netlify's `x-nf-geo` header (`city`, `country`,
  `region`, `postcode`, `latitude`, `longitude` — no third-party lookup), and
  retries once on a network error or 5xx.
- Netlify variables on every project, all contexts: `ENSO_INTAKE_URL`,
  `ENSO_INTAKE_SECRET`, `ENSO_INTAKE_ALERT_WEBHOOK`. The secret is in 1Password
  (vault *Enso Data Stack*, "ENSO website lead intake secret (n8n
  form-intake-site)"); n8n holds it as the credential "Website Direct Intake
  (x-intake-secret)". Rotate both together and redeploy.

### Payload (flat JSON)

`submission_id`, `name`, `phone`, `email`, `placement`, `host`, `url` (full
page URL incl. query), `timestamp`, `referrer`, `utm_*`, ad click IDs
(`fbclid`, `gclid`, `gbraid`, `wbraid`, `ttclid`, `msclkid`), `areaSelect`;
consent-dependent `fbp`, `fbc`, `roistat_visit`, `distinct_id`; added by the
route: `ip`, `user_agent`, geo fields.

## Infrastructure

Two n8n instances, kept separate on purpose:

| Instance | Role | URL |
|---|---|---|
| **Elestio** (legacy) | READ — source of truth for old workflows | `https://n8n-svgqc-u17606.vm.elestio.app` |
| **Railway** (new) | WRITE — intake workflows | `https://n8n-production-d2a9.up.railway.app` |

The Railway instance lives in its own Railway project **`enso-intake`**
(separate from `enso-crm` and the BI project): n8n (Docker image
`docker.n8n.io/n8nio/n8n`) + its own Postgres. Postgres-backed, encryption key
in env. (Gotcha: a mounted volume at `/home/node/.n8n` is root-owned and crashes
n8n which runs as `node` — we run volume-less, Postgres holds all state; and the
public domain needs `PORT=5678` set so Railway routes to where n8n listens.)

API access for both instances is via the n8n public REST API
(`X-N8N-API-KEY` header); keys live in the repo `.env` as `N8N_ELESTIO_*`
(read) and `N8N_RAILWAY_*` (write).

## The workflow: `Form Intake → CRM`

Two header-authenticated webhooks feed the same nodes:

- **`Webhook (site)`** — `POST /webhook/form-intake-site`, credential "Website
  Direct Intake". **The live path.**
- **`Webhook`** — `POST /webhook/form-intake`, credential "Form Intake Secret".
  The retired PostHog path; nothing calls it (its secret was rotated 2026-10-22).

```
Webhook (site) ┐
Webhook ───────┴► Resolve → Dedup Query → Dedup Decide → Already recorded?
                     ├ yes → Skip Duplicate
                     └ no  → Find Person → Person found?
                              ├ found → Build Patch → Enrich Person → Existing Carry ┐
                              └ new   → Create Person → New person → Retry find?     │
                                          ├ duplicate → Find Person (retry) → Existing (retry) ┤
                                          └ created ─────────────────────────────────────────┤
                                                       Person Ready → Create inboundActivity → Assert activity
```

### Node responsibilities

- **Resolve** (Code) — the single transform point. Reads either a flat body
  (site path) or PostHog's `body.event.properties` (legacy path), normalizes the
  phone to E.164, resolves the project and language, computes Person
  sub-fields, attribution, the synthetic flag, and the person/dedup filters.
  External id = `submission_id` → else a non-empty `form_submitted_event_id` →
  else PostHog `event.uuid`. (If you need to change mapping or normalization,
  it's here.)
- **Dedup Query → Dedup Decide → Already recorded?** — the same
  `submission_id` is the same lead. A real (non-synthetic) row always wins: an
  empty copy never blocks the real lead, and once a real lead exists any later
  copy is skipped. Fails open if the lookup errors.
- **Find Person** (HTTP → CRM GraphQL) — query `people` by
  `phones.primaryPhoneNumber` OR `emails.primaryEmail`.
- **Build Patch → Enrich Person → Existing Carry** (found branch) — fill only
  *missing* fields with `updatePerson` (never overwrites).
- **Create Person → New person** (new branch). If `createPerson` reports a
  duplicate — two submissions for the same new person seconds apart, so another
  run just created them — **Retry find?** looks the person up again instead of
  dropping the lead.
- **Create inboundActivity → Assert activity** — `createInboundActivity` with
  full attribution; the assert turns GraphQL soft errors into hard failures.

CRM auth is an n8n **encrypted Header-Auth credential** ("Twenty CRM API",
`Authorization: Bearer <key>`) **scoped to the CRM domain** — not env vars.

### Fast-ack

The webhooks use **`responseMode: onReceived`** — they return `200 {ok:true}`
immediately and process asynchronously, so a slow CRM never times out the
caller. Tradeoff: a failure *inside* n8n isn't reported back to the site — the
[error alerts](#error-alerting) cover that.

## What's captured (and the full-payload safety net)

Promoted to typed `inboundActivity` fields: name → person, `email`, `phone`
(E.164), `host`, `url` → landingPage, `referrer`, `ip`, `city`, `country`,
`utm_*`, `gclid`, `occurredAt`, `sourceExternalId` (= `submission_id`).

Also promoted to **typed fields** (for querying / conversion-API callbacks):
12 ad-click IDs — `fbclid`, `fbp`, `ttclid`, `msclkid`, `liFatId`, `igshid`,
`dclid`, `twclid`, `rdtCid`, `gbraid`, `wbraid`, `epik`; PostHog `distinctId` /
`externalId`; and `m2Requested` (NUMBER, from the form's `areaSelect`).

Person location (`currentLocation`: city, region, country, postcode, lat/lng)
and `languages` are filled on create, or patched in if missing.

**`submittedPayload` (RAW_JSON) stores the entire received body** — so any field
not promoted (and any future field) is never lost.

### m² synchronization with the deal

The form's `areaSelect` → `inboundActivity.m2Requested` (NUMBER). The
**Opportunity** carries the deal-side m² model: `m2Min` / `m2Max` (initial range
of interest) + `m2Final` (confirmed). `m2Requested` seeds the Opportunity's
`m2Min`/`m2Max`.

### Consent (implied / opt-out model)

Business/legal basis: **submitting the form = accepting Terms of Use + Privacy
Policy**, which grant email + SMS + WhatsApp + call **until the person
unsubscribes** (opt-out, not explicit opt-in). The form-submission
`inboundActivity` (timestamp + `landingPage` + raw payload) is the consent
*evidence*.

On submit the CRM **upserts `personProjectConsent`** for the resolved
(person × project): `email/sms/whatsappMarketingConsent = true`,
`*ConsentedAt = now`, `*ConsentSource = FORM_WEBSITE`. Find-or-refresh by
(person, project) — re-submission refreshes the timestamp, never duplicates.
Calls need no flag (operational 1:1; gated only by `doNotContact`).

Enforcement stays layered: `canSend(channel) = !person.doNotContact &&
personProjectConsent.<channel>`. The **opt-out half** (email unsubscribe link,
SMS `STOP`, manual) flips the row to `false` / sets `doNotContact`.

This is unrelated to the sites' **cookie** consent, which only governs
analytics and marketing tags.

## Project and language resolution

Mapping lives **in the Resolve node** (per decision; not on project records).

| Signal | → CRM project | code |
|---|---|---|
| host `artima.md` | ARTIMA Business & Lifestyle | ENS2301 |
| host `ioanaradu.md` | IOANA RADU | ENS1901 |
| host `sarmizegetusa.md` | TRIUMF BOTANICA | ENS2101 |
| `enso.ro/living` or `ensoliving.*` | ENSO LIVING | ENS2501 |
| `enso.ro/estate` or `ensoestate.*` | ENSO ESTATE | ENS2502 |
| anything else (incl. enso.ro `/`) | Vanzari Imobiliare (fallback) | ENSVI |

**Vanzari is the "project unknown at intake" bucket.** The real project is
discovered later in conversation and set on the Opportunity.

**Language** comes from the first path segment (query and hash stripped):
`/ru…` or a `-ru` suffix → RU, `/en…` or `-en` (e.g. `/living-en`) → EN,
`/ua…` → UA, otherwise RO.

## Phone normalization

In the Resolve node. Domain TLD is **not** a reliable country signal
(`enso.ro`/`ensoliving.ro` are .ro domains for a Moldovan business), so we
normalize by **national-number length**:
- 8 digits → Moldova `+373`
- 9 digits → Romania `+40`
- already `+…` → kept as-is

## Synthetic / junk flagging

`isSynthetic = true` (+ `syntheticKind`) when the lead is test data
(name/email matches `test|tst|qa|demo|example`) or has **no contact method**
(`no_contact`). Synthetic leads never create a deal or a Chat post — so test
with a "Test …" name. (Implementation note: coerce booleans — `email && regex`
is `null` when email is absent, which would violate the NOT-NULL `isSynthetic`
column.)

## Google Chat

A real website lead creates a deal; the project's marketing room gets a post
(see [internal notifications](./internal-notifications)):
sarmizegetusa.md → TRIUMF BOTANICA room, artima.md → ARTIMA room,
ioanaradu.md → **Vânzări Imobiliare** room, enso.ro/living → no room (by
decision).

## Error alerting

Two layers, both posting to the **Errors** Google Chat room:

- **Inside n8n** — the workflow's `errorWorkflow` is **"⚠️ Intake Error
  Alerts"** (Error Trigger → format → Google Chat). Fires on any execution
  error, including GraphQL soft errors turned hard by *Assert activity*.
- **Before n8n** — if a site's route can't deliver at all (n8n down, wrong
  secret, missing Netlify variables), it posts "⚠️ Website lead NOT delivered"
  with site, page, reason, the lead's contact details and `submission_id`, so
  someone can add it by hand. (`ENSO_INTAKE_ALERT_WEBHOOK`.)

## Why not PostHog

Until October 2026 the only route was a PostHog `form_submitted` event
forwarded to n8n. All four sites wrap PostHog in a cookie-consent guard: without
analytics consent the event is dropped, and with consent `name`/`email`/`phone`
are stripped. No usable website lead reached the CRM from early August until
the direct route shipped.

PostHog now gets a consent-gated, contact-free `form_submitted` for analytics.
The old destinations "HTTP Webhook → New CRM (form-intake)" are **disabled**
(kept for rollback) in the ARTIMA, ENSO Development, SARMIZEGETUSA and
IOANARADU projects. Separately, an older "HTTP Webhook" destination in some of
those projects still forwards `form_submitted` to the legacy Elestio n8n
(Attio era); it is not part of this pipeline.

## If leads stop arriving

1. Post a "Test …" lead to the site's `/api/lead` — expect `200 {"ok":true}`.
   A `500 not_configured` means the Netlify variables are missing on the
   project that serves the domain (they apply only after a redeploy).
2. Check the n8n workflow's recent executions.
3. Look in the Errors room for either alert.
