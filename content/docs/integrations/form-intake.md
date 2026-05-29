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

## Going live: pointing PostHog

PostHog form events currently feed the **legacy Elestio** workflow → Attio. To
send them to the new CRM, add/point a PostHog **webhook destination** at:

```
URL:    https://n8n-production-d2a9.up.railway.app/webhook/form-intake
Header: x-intake-secret: <secret>   (stored in n8n's encrypted credential)
Filter: form-submission events only
```

**Recommended during migration: dual-send** — add the new destination *alongside*
the existing Elestio one, so Attio keeps receiving leads while the new CRM is
validated. Cut the old one only after the new pipeline is trusted.

## Deliberately out of scope (next)

Opportunity creation + routing; other channels (calls via Roistat/Zadarma,
social via Chatwoot, Meta lead ads); Google Chat / Fivetran fan-out. This
workflow stops at **form → dedup → Person → inboundActivity**.
