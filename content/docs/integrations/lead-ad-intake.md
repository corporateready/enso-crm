---
title: Lead Ad intake (Meta → n8n → CRM)
description: The Facebook/Instagram Lead Ads inbound channel — a dedicated Meta app + multi-page leadgen webhook → n8n → Person → inboundActivity(LEAD_AD). The fifth intake channel; reuses the live form/social pipeline end-to-end.
---

# Lead Ad intake (Meta → n8n → CRM)

> Status: **Live.** The Meta app is published and delivering; the first real lead
> landed 2026-07-15 and 106 had arrived by 2026-09-17. Started 2026-06-07.

The fifth intake channel, after [form-intake](./form-intake.md),
[social-intake](./social-intake.md), and the two call sources. Facebook/Instagram
**Lead Ads** (the in-platform lead-gen forms, distinct from social DMs) flow from
Meta's `leadgen` webhook into n8n, which fetches the lead, resolves project +
identity, dedups/creates the Person, and writes one `inboundActivity` with
`kind = LEAD_AD`. From there the **live lead pipeline** produces the Opportunity
(`source = LEAD_AD`) and routes it — the pipeline is channel-agnostic, so no CRM
code was needed.

## The CRM was already scaffolded

Unlike the earlier channels, the CRM side needed **zero new code**. When form/social
intake were built, `LEAD_AD` was wired through alongside them:

- `lead-pipeline.constants.ts` maps `kind: LEAD_AD → opportunity.source: LEAD_AD`
- `consent-from-activity.service.ts` maps `LEAD_AD → consent source LEAD_AD` — a
  lead-ad submission **grants marketing consent** (the Meta form carries Terms +
  Privacy), exactly like a website form and unlike social DMs. See [consent](../systems/consent).
- Verified live on `InboundActivityCreateInput`: `kind` has `LEAD_AD`, `source`
  has `META`, `trafficType` has `PAID`, `platform` has `FACEBOOK`/`INSTAGRAM`, and
  there is a dedicated `formId` field.

## Why a dedicated Meta app + custom webhook (not the native n8n trigger)

Two Meta/n8n constraints shaped the architecture:

1. **One app, one page-object webhook callback.** A Meta app has a single callback
   URL per object (e.g. `page`). The existing **ENSO Chatwoot** app already owns the
   page webhook for Messenger/IG DMs (→ `chat.enso.ro`). Adding `leadgen` to that
   app would either hijack Chatwoot's callback or never reach n8n. So Lead Ads gets
   its **own Meta app** — "ENSO Lead Ads" (App ID `877859282026498`), Business type,
   under the already-verified **ENSO Development Moldova** business portfolio.

2. **n8n's native `facebookLeadAdsTrigger` is limited to one page per app.** With
   five working pages, the native node can't cover them. So we use a **generic
   webhook** instead: the app subscribes to the `leadgen` field, each page is
   subscribed to the app, and one n8n Webhook node receives all pages' events, then
   fetches each lead from the Graph API.

The legacy Attio "Facebook Lead Ads Forms" flow and its Zapier bridge are **not
reused** — retired with the rest of the Attio stack.

## Architecture

```
Meta Lead Ad forms (5 pages)
        │  leadgen webhook (POST)  + verify (GET hub.challenge)
        ▼
ENSO Lead Ads app (877859282026498) — Webhooks product, `leadgen` subscribed
        │  callback → n8n
        ▼
n8n "Lead Ad Intake → CRM"  (Railway, project enso-intake)
   Webhook Verify (GET) → Respond challenge
   Webhook Lead (POST, fast-ack) → Extract Leads (one item per leadgen change)
     → Fetch Lead (Graph GET /{leadgen_id}, fields=field_data,form_id,ad_id,
        campaign_name,platform… via the connected FB Lead Ads OAuth credential)
     → Resolve (map field_data, page_id→project, kind/source/trafficType, dedup key)
     → Dedup Query (inboundActivities by sourceExternalId=leadgen_id) → Is New?
       ├ new → Find Person → (enrich | create) → Create inboundActivity(LEAD_AD) → Assert
       └ duplicate → skip
        │
        ▼
LIVE pipeline (unchanged): Opportunity (source LEAD_AD) → routing → claim
```

Webhook: `POST/GET https://n8n-production-d2a9.up.railway.app/webhook/lead-ad-intake-<secret>`
(secret-in-path; verify token `enso-leadad-verify`). The Verify node echoes Meta's
`hub.challenge` so the callback validates. Fast-ack (`onReceived`) so Meta's
delivery timeout can't trigger retries → duplicate activities; the
**Dedup Query** on `sourceExternalId = leadgen_id` is the idempotency guard
(Meta can redeliver). The workflow's `errorWorkflow` is the shared
**⚠️ Intake Error Alerts** flow.

## Pages → projects

The same map as the social inboxes. Project is resolved from the Meta `page_id`;
unknown pages fall back to the Vânzări bucket (`ENSVI`), to be sharpened in
conversation.

| Facebook page | page_id | CRM project | code |
|---|---|---|---|
| Artima | `104832627735882` | ARTIMA Business & Lifestyle | ENS2301 |
| Avram Iancu | `113419554690316` | AVRAM IANCU | ENS2402 |
| ENSO Development Moldova | `824873130700445` | ENSO ESTATE | ENS2502 |
| ENSO Development România | `696169680257390` | ENSO LIVING | ENS2501 |
| Vânzări Imobiliare | `585329244673786` | Vanzari Imobiliare (unknown bucket) | ENSVI |

Other brands (TRIUMF BOTANICA, IOANA RADU, the ENSO Development umbrella) have no
working lead-ad page and are out of scope.

## Field mapping

Meta returns the lead as `field_data: [{name, values:[…]}]`. The Resolve node
flattens it and maps:

- `full_name` (or `first_name`/`last_name`) → Person name
- `email` → lowercased; `phone_number` → E.164 (8 digits → `+373` MD, 9 → `+40` RO,
  the form-intake length rule)
- any area/surface question (`m²`, `suprafață`, `spațiu`…) → `m2Requested` (NUMBER)
- `leadgen_id` → `sourceExternalId` (dedup key); `form_id` → `formId`
- `platform` → `INSTAGRAM`/`FACEBOOK`; `trafficType = PAID`
- the hidden `utm_*` form fields → `utmSource`/`utmMedium`/`utmCampaign`/`utmContent`/
  `utmTerm` — see [UTMs come from the form, not from Meta](#utms-come-from-the-form-not-from-meta)
- the **entire raw lead** → `submittedPayload` (RAW_JSON safety net)
- test/no-contact leads flagged `isSynthetic` so downstream can exclude them

Identity dedup is phone → email (the `findFilter`), reusing the form-intake query;
cross-channel reconciliation rides on the existing server-side person-merge.

## Consent

A lead-ad submission **grants marketing consent** (`personProjectConsent`, source
`LEAD_AD`) — the Meta form requires accepting Terms + Privacy, the same implied
opt-out basis as a website form. This is handled **server-side** by
`consent-from-activity` when the activity is created; the n8n workflow has no
consent node. (Contrast social DMs, which only open a reply window.)

## As-built (2026-06-07)

- **Meta app** "ENSO Lead Ads" `877859282026498` (Business, BM ENSO Development
  Moldova). Facebook Login for Business added; OAuth redirect →
  `…/rest/oauth2-credential/callback`. **Development mode** still.
- **n8n credential** "Facebook Lead Ads account" (`OC0ZM6Uhvma3Zl4o`) — connected,
  all pages granted.
- **Workflow** "Lead Ad Intake → CRM" (`UGdHwyUDeJBUtOKf`) — built via the n8n API
  (clones the Form Intake nodes), **active**; GET verify handshake confirmed
  echoing the challenge.
- **Meta Webhooks**: Page object, callback + token saved & verified, **`leadgen`
  field subscribed** (v25.0).
- **Page subscriptions** (`/{page-id}/subscribed_apps?subscribed_fields=leadgen`):
  ENSO Development Moldova confirmed; the remaining four still to confirm — see
  [Go-live](#go-live-done-with-one-item-left-to-confirm).

## Go-live: complete (verified 2026-09-17)

**All five pages are subscribed to `ENSO Lead Ads` with the `leadgen` field.** Publishing
the app, `public_profile` advanced access and `leads_retrieval` were already settled —
delivery itself proves them, since Meta sends no production leads to an unpublished app.

| page | page_id | `leadgen` |
|---|---|---|
| Artima | `104832627735882` | ✅ |
| Avram Iancu | `113419554690316` | ✅ |
| ENSO Development Moldova | `824873130700445` | ✅ |
| ENSO Development România | `696169680257390` | ✅ |
| Vânzări Imobiliare | `585329244673786` | ✅ |

### Reading this is about WHICH credential, not which permission

`GET /{page-id}/subscribed_apps` reports only the subscription of the **app that issued
the access token**. Getting a useful answer is therefore a matter of asking with a token
from the right app — there is nothing to mint:

| credential | result |
|---|---|
| **`Facebook Lead Ads account` (`OC0ZM6Uhvma3Zl4o`, user OAuth on the Lead Ads app)** | ✅ **the answer.** Fetch page tokens via `/me/accounts`, then `subscribed_apps` per page. Sees 13 pages. |
| `Facebook Lead Ads system token` (`bMIbvMPFyVcJEUPV`) | ❌ `(#200) Requires pages_manage_metadata` — system-user scopes are fixed at generation |
| Chatwoot's page tokens | ⚠️ **succeeds and lies.** Issued by the Chatwoot app, so every page reports only `ENSO Chatwoot` and Lead Ads as absent |

⚠️ **The Chatwoot route is the trap.** It returns `200` with a clean, plausible table
saying no page is subscribed. Vânzări is the control that exposes it — it reads "not
subscribed" while delivering 107 leads through the Lead Ads app's own `leadgen` webhook,
which cannot happen without a subscription. Acting on that output means "fixing" five
pages that were never broken.

Only Vânzări currently runs lead ads (`Newton Buiucani | Leads | Oferta speciala 1800
euro | Chisinau`). Artima's 29 lead adsets — 14 campaigns, RO + RU — are paused with none
planned, and the other three pages have no lead-gen adsets at all. Their silence is an
absence of campaigns, not of subscriptions: if any of them starts tomorrow, delivery
will work.

`GET /{page-id}/leadgen_forms` additionally needs `pages_manage_ads`, which no current
credential holds — so form IDs are not readable, only campaign and adset names. Nothing
depends on that.

## UTMs come from the form, not from Meta

`utm_campaign` is **ENSO's own taxonomy** — hand-authored slugs
(`newton_buiucani_comercial_new_2025`, `brand_search_ro`, `artima_facebook`) that BI
groups on, including the daily dlt sync into BigQuery. A Meta **campaign name**
(`Newton Buiucani | Leads | Oferta speciala 1800 euro | Chisinau`) is a different
namespace. Writing one into `utm_campaign` splits the taxonomy: the same spend shows
up under two labels that no `GROUP BY` can reconcile.

Lead ads carry their slugs in **hidden `utm_*` fields on the lead form**, which
marketing authors alongside the campaign. This is the lead-ad analogue of the `ref`
query string on click-to-message ads — the `ref` fix itself does **not** transfer,
because lead ad forms have no `ref`.

| CRM field | source | if the form omits it |
|---|---|---|
| `utmSource` | `fd['utm_source']` | derived from the placement (`facebook`/`instagram`) |
| `utmMedium` | `fd['utm_medium']` | `paid_social` |
| `utmCampaign` | `fd['utm_campaign']` | **`NULL`** |
| `utmContent` | `fd['utm_content']` | **`NULL`** |
| `utmTerm` | `fd['utm_term']` | **`NULL`** |

`utmSource` and `utmMedium` keep a derived fallback because those defaults are valid
slugs in their own right. The three grouping fields have no safe default: a missing
hidden field means `NULL`, **never** a Meta name. The hidden field wins even for
`utmSource` — so an Instagram-placed lead reads `utm_source = facebook` if that is what
marketing authored. No information is lost: the placement is stored separately on the
activity's `platform` column.

Meta's `campaign_name` / `ad_name` are still fetched and kept on the n8n item as
`metaCampaignName` / `metaAdName` for the execution log. They never reach the CRM.
The same rule governs tier 2 of [social intake](./social-intake.md), where it was
established first.

### As-built (2026-09-17)

Until this date the `Resolve` node wrote `lead.campaign_name` into `utmCampaign` and
`lead.ad_name` into `utmContent`, and never set `utmTerm` — while the form had been
sending all five hidden fields correctly since the channel opened. The slugs were
arriving and being discarded.

- `Resolve` now reads the hidden fields; `Create inboundActivity` gained `utmTerm`,
  which the workflow had never persisted.
- **History backfilled**: 106 activities, 105 opportunities and 104 person first-touch
  snapshots, recovered per-row from each lead's own `submittedPayload` — so no slug
  had to be guessed or transformed from a Meta name.
- Written as **direct SQL** against `workspace_71ociw77rfv6fazubi4nnuo1k`, because
  `opportunity.updateOne` has a post-hook that pushes assignment into Chatwoot and
  replaying intake would create duplicate deals and fire marketing-room notifications.
  SQL runs no hooks. Every `UPDATE` is guarded on the current campaign being absent or
  containing `|` (the Meta-name signature, which no slug has), so a re-run matches
  nothing and a hand-authored slug can never be overwritten — verified by running it
  twice (`UPDATE 106/105/104`, then `0/0/0`).
- `person.firstUtm*` is easy to miss — the first-touch snapshot is written by
  `person-first-touch.service.ts` and carried the Meta name on 104 rows.

## Deliberately out of scope (next)

- Instagram lead ads on pages not yet running them — the page→project map already
  covers them when they start.
