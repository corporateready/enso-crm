---
title: Roadmap
description: What's planned next, kept separate from the as-built pages so it's safe to cite. Pending decisions live in open-questions.
---

# Roadmap

**Status: Planned.** This page is forward-looking — as-built behavior is documented on each system/integration page; open decisions are in [open-questions](./open-questions).

## Notifications: Google Chat → in-app / Knock / Novu

Manager notifications currently go out via **Google Chat webhooks** (`manager-notification.service`, two channels: routing + ops) — deliberately simple and decoupled so a notification failure never blocks routing. Planned: richer **in-app / Knock** manager notifications and **Novu** prospect-facing notifications, swapping the transport without touching the routing timers. See [notifications](./systems/notifications), [internal-notifications](./integrations/internal-notifications), [external-notifications](./integrations/external-notifications).

## Human-agent handoff (extended reply window)

The reply-window gate already understands that Meta extends the window to **7 days when human-agent mode is on** ([chatwoot-conversations](./integrations/chatwoot-conversations)). Turning on the human-agent handoff flow is a planned capability.

## Docs access control

The `/docs` site is gated to any logged-in workspace user (the `tokenPair` cookie). Finer-grained, per-section access is **not** implemented and would be a future addition if the docs carry more sensitive operational detail. See [the docs site](./deployment#documentation-site-docs).

## Pending product decisions

The still-open scope decisions (project status for AVENEW / ENSO LIVING, lifecycle email cadences, CPQ API surface, etc.) are tracked in [open-questions](./open-questions) and resolved there as they land.
