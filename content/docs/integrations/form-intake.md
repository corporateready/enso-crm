---
title: Form intake (n8n → CRM)
description: The live website-form intake pipeline — standalone n8n on Railway, PostHog form events → dedup → Person → inboundActivity.
---

# Form intake (n8n → CRM)

The first rebuilt intake channel: website **form submissions** flow from PostHog
into a standalone n8n instance, which resolves the project, dedups the person,
and writes an `inboundActivity` into the CRM. This replaces the form half of the
legacy `Forms Workflow for Attio` (which wrote to Attio).

## Infrastructure

Two n8n instances, kept separate on purpose:

| Instance | Role | URL |
|---|---|---|
| **Elestio** (legacy) | READ — source of truth for existing workflows | `https://n8n-svgqc-u17606.vm.elestio.app` |
| **Railway** (new) | WRITE — new intake workflows | `https://n8n-production-d2a9.up.railway.app` |

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

Active on the Railway instance. Webhook: `POST /webhook/form-intake`,
**header-authenticated** (`x-intake-secret`, validated by an n8n Header-Auth
credential — reject if absent/wrong).

```
Webhook (header-auth) → Resolve → Find Person → If(found?)
  ├ found → Build Patch → Enrich Person → Existing Carry ┐
  └ new   → Create Person → New person ──────────────────┤→ Create inboundActivity → Respond
```

### Node responsibilities

- **Resolve** (Code) — the single transform point. Parses the PostHog payload
  (`body.event.properties.*`), normalizes the phone to E.164, resolves the
  project, computes Person sub-fields, attribution, synthetic flag, and the
  dedup filter. (If you need to change mapping or normalization, it's here.)
- **Find Person** (HTTP → CRM GraphQL) — query `people` by
  `phones.primaryPhoneNumber` OR `emails.primaryEmail`.
- **Person found?** (If) — `data.people.totalCount > 0`.
- **Build Patch → Enrich Person → Existing Carry** (found branch) — compute
  only the *missing* fields and `updatePerson` to fill gaps (never overwrites
  existing values), then carry `{...resolve, personId}` forward.
- **Create Person → New person** (new branch) — `createPerson`, then carry
  `{...resolve, personId}` forward.
- **Create inboundActivity** (HTTP → CRM GraphQL) — `createInboundActivity`
  linked to person + project, with full attribution.
- **Respond** — returns `{ ok, activity, basis, projectCode }`.

CRM auth is an n8n **encrypted Header-Auth credential** ("Twenty CRM API",
`Authorization: Bearer <key>`) **scoped to the CRM domain** — not env vars.

### PostHog payload shape

n8n wraps the POST body under `$json.body`, so the real PostHog event
`{ event: { properties: {...} } }` is read as `$json.body.event.properties`.
Fields used: `name`, `email`, `phone`, `$host`, `$pathname`, `$current_url`,
`$referrer`, `utm_*`, `gclid`/`$gclid`, `$ip`, `$geoip_city_name`,
`$geoip_country_name`, `roistat_visit`; plus `event.uuid` (→ `sourceExternalId`)
and `event.timestamp` (→ `occurredAt`).

## Project resolution (host + path → CRM project)

Mapping lives **in the Resolve node** (per decision; not on project records).
Single "ENSO development" PostHog project on `enso.ro` with path-routed
sub-projects; standalone brands on their own domains. AVRAM IANCU and (legacy)
Vanzari have no web intake.

| Signal | → CRM project | code |
|---|---|---|
| host `artima.md` | ARTIMA Business & Lifestyle | ENS2301 |
| host `ioanaradu.md` | IOANA RADU | ENS1901 |
| host `sarmizegetusa.md` (PostHog "SARMIZEGETUSA") | TRIUMF BOTANICA | ENS2101 |
| `enso.ro/living` or `ensoliving.*` | ENSO LIVING | ENS2501 |
| `enso.ro/estate` or `ensoestate.*` | ENSO ESTATE | ENS2502 |
| anything else (general FB/IG page, unknown) | Vanzari Imobiliare (fallback) | ENSVI |

**Vanzari is the "project unknown at intake" bucket.** Lead-gen surfaces with
no specific project tag land here; the real project is discovered later in
conversation and set on the Opportunity (not the inboundActivity).

## Phone normalization

In the Resolve node's `e164()` function. Domain TLD is **not** a reliable
country signal (`enso.ro`/`ensoliving.ro` are .ro domains for a Moldovan
business), so we normalize by **national-number length**:
- 8 digits → Moldova `+373`
- 9 digits → Romania `+40`
- already `+…` → kept as-is

## Synthetic / junk flagging

`isSynthetic = true` (+ `syntheticKind`) when the lead is test data
(name/email matches `test|tst|qa|demo|example`) or has **no contact method**
(`no_contact`). Lets downstream exclude these from real intake.
(Implementation note: coerce booleans — `email && regex` is `null` when email is
absent, which would violate the NOT-NULL `isSynthetic` column.)

## PostHog wiring — LIVE (dual-send)

PostHog (EU, `https://eu.posthog.com`) has **6 projects**; forms fire the
`form_submitted` event and an "HTTP Webhook" destination posts
`{event, person}` to n8n. We added a **second destination** ("HTTP Webhook →
New CRM (form-intake)") in each relevant project — **dual-send**: the existing
Attio destination is untouched, and a copy now flows to the new CRM.

| PostHog project | id | → CRM project |
|---|---|---|
| ARTIMA Business & Lifestyle | 36450 | ARTIMA (ENS2301) |
| IOANARADU | 128764 | IOANA RADU (ENS1901) |
| SARMIZEGETUSA | 126393 | TRIUMF BOTANICA (ENS2101) |
| AVENEW Botanica | 99901 | TRIUMF BOTANICA (ENS2101) — still live |
| ENSO Development | 107041 | ENSO LIVING / ESTATE (by path) |

New destination config (per project): URL
`https://n8n-production-d2a9.up.railway.app/webhook/form-intake`, header
`x-intake-secret: <secret>`, body `{"event":"{event}","person":"{person}"}`,
trigger `form_submitted`. Verified end-to-end (PostHog → n8n → CRM).

**Cutover:** when the new CRM is trusted, disable the old Attio "HTTP Webhook"
destinations (don't delete — keep as rollback). PostHog creds are in `.env`
(`POSTHOG_HOST`, `POSTHOG_PERSONAL_API_KEY`).

### Fast-ack (avoid duplicate deliveries)

The webhook uses **`responseMode: onReceived`** — it returns `200 {ok:true}`
immediately and processes asynchronously. This matters: the CRM work is 3
sequential GraphQL calls (find → create person → create activity); if the
webhook blocked on those, PostHog's delivery timeout would fire and **retry →
duplicate activities**. Fast-ack decouples delivery from processing. Tradeoff: a
downstream failure is not surfaced to PostHog (won't retry) — inspect n8n
execution logs for failures (a future error-workflow should alert on these).

## Error alerting

Because fast-ack means a downstream failure isn't surfaced to PostHog, a
separate n8n workflow **"⚠️ Intake Error Alerts"** (Error Trigger → format →
Google Chat) is set as the intake workflow's `errorWorkflow`. It fires on any
execution error and posts the workflow, failed node, error message, and
execution URL to the ops Google Chat space.

Two failure classes are covered:
- **Hard failures** (network / 502 / auth / node bugs) → execution errors →
  alert automatically.
- **Soft GraphQL errors** — the CRM returns HTTP 200 with an `errors` array even
  when a mutation fails (so n8n would otherwise mark it "success"). An **Assert
  activity** node after `Create inboundActivity` throws if the response has
  `.errors` or no `createInboundActivity`, converting the soft failure into a
  hard one so it alerts too. (This class is what the `isSynthetic` NOT-NULL bug
  was — silently "successful" with no record created.)

Verified end-to-end (forced failure → Google Chat alert delivered). Future:
a dead-letter/retry queue so failed leads auto-recover rather than needing
manual re-entry from the alert.

## Deliberately out of scope (next)

Opportunity creation + routing; other channels (calls via Roistat/Zadarma,
social via Chatwoot, Meta lead ads); Google Chat / Fivetran fan-out. This
workflow stops at **form → dedup → Person → inboundActivity**.
