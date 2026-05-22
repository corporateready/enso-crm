---
title: Telephony
description: Zadarma SDK direct in Twenty + Roistat webhook in n8n + Moldcell observed via Roistat.
---

# Telephony

Three players. Roistat is the attribution layer. Zadarma is the programmable RO provider. Moldcell is the MD call-center (no public API).

## Where each piece lives

| Piece | Layer | Module / flow |
|---|---|---|
| Roistat call webhook receiver | n8n | `roistat-call-intake` flow → POST to Twenty `/api/intake/call` |
| Zadarma direct webhook receiver | n8n | `zadarma-direct-intake` flow → POST to Twenty `/api/intake/call` |
| Zadarma SDK calls (click-to-call, recordings, extension list) | Twenty fork | `telephony-zadarma` NestJS module — replaces `zadarma-signer` Render service |
| Zadarma "who answered" reconciliation | Twenty fork | BullMQ job triggered by `notify_record` event |
| Roistat outcome push-back (on deal close) | Twenty fork | `attribution` module event listener |
| Daily Zadarma extension sync | Trigger.dev | scheduled job, updates `users.sip_extension` |
| Moldcell call observation | (no direct integration) | Observed indirectly via Roistat when DID-substituted |

## Roistat — attribution feed

Roistat substitutes DIDs per campaign, captures `visit_id` + UTM, fires webhook to n8n.

| Aspect | Detail |
|---|---|
| Auth (incoming webhook) | None native — n8n verifies by IP allowlist + path secret |
| Auth (CRM → Roistat outbound) | `Api-key: <key>` header + `?project=12345` query |
| Rate limit (Roistat API) | 10/sec, 5k/hour per project |
| Webhook fires per call | Twice — at start + at completion (dedup in Twenty by `roistat_call_id`) |

n8n's `roistat-call-intake` flow:
1. Receive webhook
2. Normalize phone (`callee` → E.164)
3. Identify provider (RO=Zadarma, MD=Moldcell by callee prefix)
4. POST to Twenty `/api/intake/call` with `{ provider: 'roistat', payload: <normalized> }`
5. Twenty deduplicates by `(roistat, roistat_call_id)`, merges start + end events into one Activity

CRM → Roistat (outcome push-back):
- Twenty's `attribution` module listens for `deal.stage_changed` to `ClosedWon`
- Posts to `POST /project/phone-call?project=12345` with `order_id: deal.id`, `value_eur`, `closed_at`, `visit_id`
- Roistat dashboards then show revenue per source

## Zadarma — programmable RO provider

Twenty's `telephony-zadarma` NestJS module wraps the Zadarma SDK directly. No more `zadarma-signer` on Render — folded into our backend.

### What we use

| Capability | Endpoint | Where in Twenty |
|---|---|---|
| Webhook receive (notify_start/answer/end/record/etc.) | n8n receives, posts to Twenty | n8n + intake module |
| Click-to-call | `GET /v1/request/callback/` | `telephony-zadarma.click-to-call(managerSip, prospectPhone)` |
| Recording retrieve | `GET /v1/pbx/record/request/` | `telephony-zadarma.get-recording-url(callId)` (returns signed URL) |
| Extension list + employee names | `GET /v1/pbx/internal/` + `.../sip/info/` | Daily Trigger.dev job → updates `users.sip_extension` cache |
| Stats reconciliation | `GET /v1/statistics/` | "Who answered" job: triggered by `notify_record`, queries stats, matches by call_start ±60min, resolves SIP → user |

### Auth signing

HMAC-SHA1 over `(method + sorted_query + md5(query))`, Base64'd. Implemented inline in `telephony-zadarma.signer.ts`. Same logic as the Render service; ~30 lines of TypeScript.

### Replacing the "who answered" workaround

Today's flow: webhook arrives → wait ~minutes → call `zadarma-signer.onrender.com/get-who-answered` → match call → return SIP.

Rebuild flow:
1. Webhook (`notify_record`) arrives → Activity inserted with `recording_url`
2. BullMQ job scheduled +90 seconds
3. Job queries Zadarma stats for the matching call (callee + ±60min window)
4. Match found → update Activity's `answered_by_user_id` (resolved from cached SIP map)
5. If no match yet → retry in 10 min, max 3 attempts

Recording URL stays valid for 30 min (Zadarma signed URLs default 1800s lifetime). Attached to Activity for playback in Twenty UI.

### Click-to-call

From a deal in Twenty, manager clicks "Call". Twenty:
1. Validates manager has `sip_extension` set
2. Calls `telephony-zadarma.click-to-call(manager.sip_extension, deal.person.phone_e164)`
3. Zadarma rings manager's extension first, then bridges to prospect
4. Creates an `interaction` row (`kind=outbound_call`) immediately, fills `recording_url` when `notify_record` arrives

## Moldcell PBX — black box, observed via Roistat

No public API. The `binaagency.pbx.moldcell.md` portal is operator-side; we don't touch it.

How we know about Moldcell calls:
- Roistat substitutes Moldcell DIDs and captures the call event at the Roistat layer (regardless of which provider terminates the call)
- For Roistat-attributed Moldcell calls → we get full webhook payload as if Zadarma fired it
- For non-attributed Moldcell calls (direct dialing) → **invisible to CRM**. Acceptable for v1.

If non-attributed Moldcell observability matters later:
- Call Moldcell business support (022 206 060) to ask about a partner API
- Or configure Moldcell PBX dial-plan to fork incoming calls to a SIP endpoint we control (heavy)

For now: assume Moldcell calls only enter CRM via Roistat-mediated paths.

## Provider routing decision matrix

| Caller DID country | Provider | Roistat-tracked? | Recording source |
|---|---|---|---|
| +40 (RO) tracked | Zadarma | Yes | Roistat webhook payload `link` |
| +40 (RO) direct | Zadarma | No | Zadarma `notify_record` |
| +373 (MD) tracked | Moldcell | Yes | Roistat webhook payload `link` |
| +373 (MD) direct | Moldcell | No | **invisible** (out of scope) |

## What we drop from the current setup

- `zadarma-signer.onrender.com` Render service — replaced by `telephony-zadarma` NestJS module
- Upstash Redis call-dedup cache — replaced by Postgres `webhook_events(provider, external_id)` UNIQUE
- 119-node `Calls Workflow for Attio` — replaced by 1 thin n8n receiver flow + Twenty's intake + reconciliation modules
- Per-brand "Incoming Calls" flows (`Parents | ARTIMA Incoming Calls`, etc.) — consolidated into one intake path with brand resolved from Roistat `custom_fields.project_id`
- Test flows (`test-pbx-event`, `TEST Incoming Calls`) — deleted

## Open questions specific to telephony

- **SIP extension naming convention** — Zadarma uses 3-4 digit extensions. We need a clear mapping doc: extension X = manager Y. Daily sync builds it, but the source of truth is Zadarma's PBX config.
- **Moldcell extension visibility** — if managers have separate extensions for MD vs RO calls, do they want unified "who answered" or separate tracking?
- **Direct line vs Roistat-tracked policy** — should ALL inbound calls be routed through Roistat substitution (= full attribution + observability), or are some direct numbers (e.g. ops/internal) intentionally outside Roistat?
