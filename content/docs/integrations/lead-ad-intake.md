---
title: Lead Ad intake (Meta → n8n → CRM)
description: The Facebook/Instagram Lead Ads inbound channel — a dedicated Meta app + multi-page leadgen webhook → n8n → Person → inboundActivity(LEAD_AD). The fifth intake channel; reuses the live form/social pipeline end-to-end.
---

# Lead Ad intake (Meta → n8n → CRM)

> Status: **Built — pending go-live.** The Meta app, OAuth, n8n workflow, and
> app-level `leadgen` webhook are all live and the webhook handshake is verified.
> Real lead delivery is gated on **publishing the app** (App Review for
> `leads_retrieval`) — Meta delivers no production leads while the app is in
> Development. Started 2026-06-07.

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
- `platform` → `INSTAGRAM`/`FACEBOOK`; `trafficType = PAID`; `utmSource =
  facebook|instagram`, `utmMedium = paid_social`, `utmCampaign = campaign_name`,
  `utmContent = ad_name`
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
  ENSO Development Moldova confirmed; the remaining four to be finished at go-live
  (inert until the app is published — see below).

## Remaining to go live

Meta delivers **no production leads while the app is unpublished** (only dashboard
"Test" webhooks). To go live:

1. **Privacy Policy URL** on the app (App settings → Basic) — required to publish.
2. **`public_profile` advanced access** (Facebook Login for Business requirement).
3. **`leads_retrieval` access** — own/managed pages may qualify for Standard Access
   (as the Chatwoot build found); otherwise App Review (the one multi-day external
   dependency). Verify in practice.
4. Finish subscribing the remaining four pages, then **toggle the app to Live**.
5. Verify end-to-end with Meta's **Lead Ads Testing Tool** → lead → Person →
   `inboundActivity(LEAD_AD)` → Opportunity(`LEAD_AD`) + consent; clean up test records.

## Deliberately out of scope (next)

- Lead-form `ref`/UTM passthrough beyond campaign/ad names (Meta lead forms don't
  carry web UTMs; we derive what we can from campaign metadata).
- Instagram lead ads on pages not yet running them — the page→project map already
  covers them when they start.
