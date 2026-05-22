---
title: Activities and Interactions
description: Two separate streams — inbound events (Activities) and outbound actions (Interactions). Per user, never mixed.
---

# Activities and Interactions

User direction was unambiguous:

> "Activities and Interactions or Inbound and Outbound is not the same"

So we keep them in two separate tables, both linked to People and Deals.

## Activities — inbound only

What the prospect did to reach us.

```text
activities
├── id (uuid)
├── kind (enum: form_submission, incoming_call, social_message, lead_ad, appointment_booked, callback_request)
├── person_id (fk, nullable until resolved)
├── deal_id (fk, nullable until deal exists)
├── project_id (fk, nullable — derived from intake metadata)
├── occurred_at (timestamptz)
├── created_at, ingested_at
├── source (text) — provider (Roistat, Zadarma, Chatwoot, Meta, website, n8n)
├── source_external_id (text) — provider's record id, for dedup
├── status (enum: pending, processed, error, duplicate)
│
├── -- per kind --
├── (call) caller_e164, callee_did, duration_s, recording_url, call_status, sales_pickup, non_sales_pickup_by
├── (form) host, form_id, payload (jsonb)
├── (social) platform (instagram, facebook, telegram, viber, whatsapp), chatwoot_conversation_id, external_thread_id, body
├── (lead_ad) form_id, payload (jsonb)
├── (appointment) ical_event_id, attendee_email, scheduled_for
│
├── -- attribution --
├── utm_source, utm_medium, utm_campaign, utm_content, utm_term
├── traffic_type, host, landing_page, referrer
├── roistat_visit_id
├── ip_address, city, country
├── google_client_id
│
├── -- ai/synthetic separation --
├── is_synthetic (boolean) — AI chatbot conversations get true here, excluded from deal creation
└── synthetic_kind (text, nullable) — "ai_chatbot", "test", etc.
```

→ This replaces Attio's single Activities object (33 attributes, all denormalized) with a properly-typed event stream. Per-kind nullable columns are fine — Postgres handles sparse rows efficiently.

### Call status — replacing the broken "Missed" semantics

Today every call is `status: Missed`. We split:

```text
call_status enum: answered, unanswered, voicemail, busy, congestion, abandoned, sales_pickup, non_sales_pickup
```

Two parallel facts on a call activity:
- `call_status` — what happened (from telephony provider)
- `sales_pickup` (boolean) — did a sales-eligible extension answer (vs. front desk / security)

If `sales_pickup=false` AND `call_answered_by` is "Paza ARTIMA" / "Reception ARTIMA" / "Техник", the deal **does not advance** to Sales Accepted Lead — those answers don't count for the funnel.

See [open-questions](../open-questions) #8 for the user-decided semantics.

## Interactions — outbound only

What we did to engage the prospect.

```text
interactions
├── id (uuid)
├── kind (enum: outbound_call, outbound_sms, outbound_email, outbound_whatsapp, outbound_viber, outbound_telegram, outbound_social_message, meeting_held, demo_held, note_left)
├── person_id (fk)
├── deal_id (fk, nullable)
├── by_user_id (fk → users) — the agent
├── occurred_at (timestamptz)
├── status (enum: pending, sent, delivered, failed, replied)
│
├── -- per kind --
├── (outbound_call) callee_e164, duration_s, recording_url, outcome_id (fk → outcomes)
├── (outbound_sms / whatsapp / viber / telegram / social) message_body, channel_message_id, chatwoot_conversation_id
├── (outbound_email) subject, body, customerio_message_id
├── (meeting / demo) location, attendees (jsonb), notes
├── (note) body
│
├── -- linkage to sequence / task --
├── task_id (fk → tasks, nullable) — if logged from a task
├── -- linkage to ad-hoc --
└── ad_hoc (boolean) — true if not linked to any task
```

### Why the split matters

1. **Stage transitions key off Interactions**, not Activities. `Connected` stage requires at least one outbound interaction reaching the prospect — that's an Interaction with `status ∈ {delivered, replied}`.

2. **Sequence completion logs an Interaction**, not an Activity. When a manager completes a "Call Interaction #1 — Lead Claimed" task with disposition Connected, that's an `interactions` row of `kind=outbound_call, outcome_id=connected`.

3. **Attribution sums** are cleaner when inbound and outbound are separate. "Average days from first Activity to first Interaction reaching the prospect" is a real KPI; it's hard if both are in one table.

## Why not one `events` table

The user said don't mix them. There's also a real signal-vs-noise reason: when computing "what's our response time to inbound leads," `min(interactions.occurred_at) - min(activities.occurred_at)` is the answer. With a single mixed table, the query needs a direction filter that's easy to forget.

## Shared concerns

| Concern | Activities | Interactions |
|---|---|---|
| Linked to Person | Yes | Yes |
| Linked to Deal | Yes (deferred — created before deal exists, attached later) | Yes |
| BigQuery emission | Yes (event stream) | Yes (event stream) |
| Recording URL | If applicable (calls) | If applicable (calls + demos) |
| UTM/attribution | Yes (frozen at intake) | No (outbound has no attribution) |
| Sync source | Webhooks from Roistat / Zadarma / Chatwoot / forms / Meta | Direct from manager actions in our UI; provider receipts arrive async |

## Outbound channel mapping

| `kind` | Provider | Transport |
|---|---|---|
| `outbound_call` | Zadarma click-to-call | `GET /v1/request/callback/` |
| `outbound_sms` | Customer.io transactional API | (existing setup) |
| `outbound_email` | Customer.io | (existing setup) |
| `outbound_whatsapp` | Chatwoot WhatsApp inbox | Chatwoot API |
| `outbound_viber` | Chatwoot Viber inbox | Chatwoot API |
| `outbound_telegram` | Chatwoot Telegram inbox | Chatwoot API |
| `outbound_social_message` | Chatwoot Instagram/Facebook inbox | Chatwoot API |
| `meeting_held` / `demo_held` | Manual UI entry | — |
| `note_left` | Manual UI entry | — |

## What today's Activities object becomes

Today's flat 33-column Activities object splits as:

| Today's Activity | Becomes |
|---|---|
| Inbound form/call/social/lead-ad | `activities` row, typed by `kind` |
| `Filling in the Fields` placeholder | gone (it's a task template, see [domains/sequences-and-tasks](./sequences-and-tasks)) |
| "Incoming Message from AI CHAT" | `activities` with `is_synthetic=true, synthetic_kind='ai_chatbot'` |
| Test data ("Form | test tst1") | `is_synthetic=true, synthetic_kind='test'` + migration cleanup script |
