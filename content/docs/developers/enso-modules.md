---
title: enso modules
description: Map of the custom enso-specific backend modules under packages/twenty-server/src/modules/enso — what each one does and where to start reading.
---

# enso modules

**Status: Shipped.** This is the as-built map of the code we add on top of the Twenty fork.

All enso-specific backend logic lives under `packages/twenty-server/src/modules/enso/`. Each module is a NestJS module wired into `ModulesModule`. The recurring implementation patterns (composite names, query hooks, system auth context, best-effort writes) are described in [custom-code-patterns](./custom-code-patterns).

## lead-pipeline

The intake → opportunity → routing engine. Driven by BullMQ jobs, each a stage:

- **`resolve-opportunity-from-activity.job`** (Stage 1) — an `inboundActivity` was created; dedupe and either attach to an open deal or create a new one. New deals hand off to routing. Also fans out to first-touch attribution and consent.
- **`route-opportunity.job`** (Stage 2) — assign a manager to an opportunity in `ROUTING`: sticky owner → auto-claimed (`LEAD_CLAIMED`, no window); round-robin → notify + open a 3-min claim window; no available manager → **parked** with a heartbeat.
- **`claim-check.job`** — the claim window expired; no-op if already claimed/sticky, else reroute (forever; parks when the pool is offline, resumes when someone returns; admin heads-up after N reroutes).
- **`notify-manager-assignment.job`** (Stage 3) — tell the assigned manager (Google Chat) they have a lead to claim. Separate so notification channels can evolve and a failure never blocks the timer.

Services: `opportunity-resolution` (dedupe/attach/create), `opportunity-routing` (assignment outcome), `opportunity-claim` (sticky-owner stickiness on claim), `opportunity-name` (`Deal | <phone/name> | <project>`), `person-first-touch` (freezes earliest-touch attribution on the Person), `person-timeline` (timeline activity linkage), `consent-from-activity` (per-project marketing consent — see [consent](../systems/consent)), `manager-notification` (Google Chat webhooks).

See [lead-pipeline](../systems/lead-pipeline), [routing](../systems/routing), [attribution](../systems/attribution).

## person-project-consent

Per-(person × project) marketing consent across 4 channels, with audit + provenance. Query hooks materialize the composite name and stamp grant/revoke audit fields. Fully documented in [consent](../systems/consent).

## person-project-assignment

Junction (person × project × manager). Carries the **sticky manager** assignment per (person, project) — it outlives individual deals and drives routing + view filtering. `person-project-assignment-name.service` materializes `<project> · <manager>`.

## project-routing-member

Junction (project × workspaceMember) defining the **routing pool**: which managers receive round-robin leads for which project. Name: `<project> · <manager>`.

## person-relationship

Junction (person × relatedPerson × type), e.g. spouse/parent/child. `person-relationship-mirror.service` auto-creates the inverse row (CHILD ⇄ PARENT) with a `mirrorOfId` loop-guard. Name: `<type> · <relatedPerson>`.

## person-merge

Phone/email-based duplicate detection and merge:
- **`find-person-duplicates.job`** — a person was created/updated; if it now shares a phone/email with others, hand the set to the merge job.
- **`merge-person-duplicates.job`** — merge a confirmed duplicate set into the oldest record.

Services: `person-duplicate-finder`, `person-merge-executor`. See [identity-resolution](../systems/identity-resolution).

## inbound-activity

`inbound-activity-name.service` materializes the activity label `{Type} | {name-or-phone} | {project}` + timestamp (people produce many inbound events; the time keeps labels unique). See [activities-and-interactions](../domains/activities-and-interactions).

## chatwoot

The omnichannel inbox integration:
- **`chatwoot-agent-provisioning`** — maps CRM managers → Chatwoot agents **by email**, idempotently (Application + Platform APIs), adding account + inbox membership.
- **`chatwoot-assignment`** — on claim, push the deal's owner onto **every** conversation on the deal (CRM is the source of truth; Chatwoot auto-assignment stays off).
- **`chatwoot-client`** — reads Chatwoot's reply-window verdict (`can_reply`) so we never reimplement Meta's policy.
- **`chatwoot-conversation-resolver`** — resolves a conversation + its CRM context (person/opportunity/project) for the Conversations list.
- **`chatwoot-messaging`** — channel labels and messaging helpers.

See [chatwoot-conversations](../integrations/chatwoot-conversations), [messaging](../integrations/messaging).
