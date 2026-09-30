---
title: Chatwoot conversations
description: How Chatwoot's omnichannel inbox is wired into the CRM — agent provisioning, assignment writeback, the reply window, and the Conversations surface. CRM is the source of truth.
---

# Chatwoot conversations

**Status: Shipped.** Backend in `modules/enso/chatwoot`; UI surfaced on records.

Chatwoot is the omnichannel inbox (Instagram, Facebook, WhatsApp, …). The CRM does not replace it — it **drives** it: assignment and ownership flow CRM → Chatwoot, and conversations surface back inside the CRM. See [messaging](./messaging) for the channel/intake side and [social-intake](./social-intake) for DM capture, and [email-intake](./email-intake) for the brand email inboxes (marketing replies).

## Agent provisioning (by email)

`chatwoot-agent-provisioning` maps CRM managers → Chatwoot agents **by email** — no separate mapping table. It's idempotent: look the agent up by email (Application API), create via the Platform API only if absent, then ensure **account membership** (mandatory, or the SSO'd dashboard hangs) and **inbox membership** (so the agent can see the threads).

## Assignment writeback (CRM is the source of truth)

Chatwoot's own auto-assignment stays **off**. When a deal is claimed (leaves `ROUTING` with an owner), `chatwoot-assignment` pushes that owner onto **every** conversation on the deal, so all threads land in the owner's queue. Ownership decisions live in the CRM's [routing](../systems/routing); Chatwoot just reflects them.

## The reply window (`can_reply`)

Meta enforces a messaging window (FB/IG 24h, extended to 7d when human-agent mode is on). Rather than reimplement that, `chatwoot-client` reads Chatwoot's own `can_reply` verdict: `false` = window closed (don't allow an outbound reply), `null` = Chatwoot didn't report it. The in-CRM composer is gated on this so managers can't send into a closed window.

## Conversations surface

`chatwoot-conversation-resolver` resolves a conversation together with the CRM context needed for a list row — the linked **person / opportunity / project** and created date — so inbound chats are browsable inside the CRM (the Conversations view) and embedded on the record, not only in the Chatwoot dashboard. Channel labels (e.g. "Instagram") come from `chatwoot-messaging`.

## Replies are logged

A reply sent from the in-CRM panel is logged like any manager touch: one `outboundActivity` (channel from the inbox — EMAIL / SOCIAL / WHATSAPP / SMS, `performedBy` the manager) plus a timeline sentence on the person and the deal ("Replied by email · Re: …", "Replied on Instagram"). Logging runs after Chatwoot delivered the message and never fails the send. Replies typed in Chatwoot's own UI are not logged.

## Lifecycle

- Conversations **auto-resolve after 24h** of inactivity, so a returning prospect starts a fresh session (clean re-engagement capture rather than reopening a stale thread).
- On **deal close**, the deal's conversations are resolved — a later message opens a new session and re-enters intake.
