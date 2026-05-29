# Next session — Inbound Activity → Opportunity → Routing

_Start here. Read `docs/SESSION_HANDOFF.md` (full live state + operating playbook)
and `content/docs/integrations/form-intake.md` (the intake pipeline) first._

## Where the last session left off

The **form-intake channel is live and complete**: PostHog `form_submitted`
(dual-send across 5 projects) → n8n `Form Intake → CRM` workflow → resolves
project → E.164 phone → dedups/enriches **Person** → creates **`inboundActivity`**
(full attribution, ad-click IDs, `m2Requested`, raw payload) → upserts
**`personProjectConsent`** (implied opt-out consent) → error-alerted, fast-ack.

So today: a website form produces a **Person** + an **`inboundActivity`** (+ consent).
**It stops there.** No Opportunity, no routing yet.

## The mission

Continue the pipeline downstream:

```
inboundActivity (exists)
  → resolve/create OPPORTUNITY  (dedup: deal per person × project × time-window)
  → seed deal fields            (project, m2Min/m2Max from m2Requested, source, firstContact*, UTMs frozen)
  → ROUTE the opportunity       (assign a manager; sticky per person×project)
  → 3-min claim window + reroute + escalation
  → (later) kick the first SEQUENCE / tasks
```

This re-implements the legacy n8n `Creating a Deals` (22 nodes) + `Routing
Automation` (38 nodes) + `Distribution of Deals`, but writing to the new CRM.

## Read these design docs (the plan already exists)

- `content/docs/domains/deals.md` — Opportunity model: **stage state machine**
  (Routing → Lead Claimed → Connected → Deep Qualification → Demo → Contracting →
  Closed Won/Lost), the **2D model** (stage × pipelineState), one `project` FK,
  frozen source attribution, lost reasons, merge.
- `content/docs/systems/routing.md` — routing algorithm: candidate =
  `available + assigned-to-project`, **true round-robin** (`last_assigned_at` asc,
  then active-client-count, then random), **3-min claim-or-reroute**, escalate at
  `routing_count >= 5`, auto-claim on first action.
- `content/docs/domains/leads.md` §"Resolving to a Deal" — dedup rule:
  deal-per-person within a **14-day window** (proposed; Attio did "ever exists"),
  attach activity to existing deal else create (stage `Routing` for forms).
- `content/docs/systems/junction-composite-name-pattern.md` — the pattern for any
  new junction object (composite name + optional mirror-write + system-auth reads).

## Relevant live CRM objects/fields

- **opportunity** (`a71b2bcb-9380-4b84-9f94-b6ddc19b103b`): `stage` SELECT
  (incl. `ROUTING`), `pipelineState` SELECT, `project`→project, `owner`→workspaceMember,
  `pointOfContact`→person, `routingCount` NUMBER, `m2Min`/`m2Max`/`m2Final`,
  `relatedOpportunity`, `lostReason`, `firstContactChannel`/`firstContactAt`,
  full UTM set, `amount`, `closeDate`. (Deal-level fields like `dealType`,
  `closedAt`, `lostReason`→SELECT may still need adding — verify.)
- **personProjectAssignment** (`3f107ab7-…`): the **sticky manager** entity
  (person × project × manager), outlives deals; composite-name hook live.
  Routing should consult/update this — the assigned manager for a (person,project)
  is sticky and routes future inquiries.
- **inboundActivity** (`cef40992-…`): the trigger. Has `person`, `project`,
  `opportunity` (relation, currently unset), `m2Requested`, attribution, etc.
- Project records + the host/path→project map: see form-intake doc.

## Key decisions already made (carry forward)

- Attribution lives on `inboundActivity`; the Opportunity gets a **frozen snapshot**
  of first-touch attribution at creation (per deals.md), sourced from the activity.
- `m2Requested` (activity) → seed `opportunity.m2Min`/`m2Max`.
- Vanzari Imobiliare = the "project unknown at intake" fallback; real project is
  refined on the Opportunity later in conversation.
- Twenty supports only MANY_TO_ONE / ONE_TO_MANY — use junctions for m:m.
- Consent is implied/opt-out; enforcement `!doNotContact && consent`.

## Open design questions to settle first

1. **Where does Opportunity creation run?** Extend the n8n form-intake workflow
   (chain after `inboundActivity`)? A new n8n workflow triggered on
   `inboundActivity` create? Or a **CRM-side `inboundActivity.createOne` post-query
   hook** (NestJS, like the composite-name hooks)? Trade-off: n8n = visible/editable;
   CRM hook = atomic, no extra hop, reuses system-auth pattern. **Recommend deciding
   this before building.**
2. **Deal dedup window** — confirm 14 days (vs "ever exists"). Re-engaging old leads
   should make a fresh deal, not comment on a cold one.
3. **The 3-min claim timer + reroute** — where does the timer live? n8n `wait`,
   a Twenty BullMQ job, or Trigger.dev? (Stack plan leans Trigger.dev for jobs.)
4. **Routing fairness** — port round-robin from routing.md (legacy used `Math.random()`).
5. **owner vs personProjectAssignment** — reconcile: `opportunity.owner` is the
   deal's manager; `personProjectAssignment` is the sticky person×project manager.
   On route: check for an existing sticky assignment first (honor it), else
   round-robin and create the assignment.
6. **Manager notification** — Google Chat now (webhook in hand:
   `chat.googleapis.com/v1/spaces/AAQA-eMmZDo/...`), in-app (Knock) later.

## Operating playbook (so you can act immediately)

- Secrets: repo `/.env` (`set -a && source .env && set +a`). CRM:
  `$TWENTY_BASE_URL/graphql` + `/metadata`, `Bearer $TWENTY_API_KEY`. ⚠️ data
  queries return soft-deleted rows unless you filter `deletedAt:{is:NULL}`.
- n8n (write): `N8N_RAILWAY_*` in `.env`, REST `X-N8N-API-KEY`. Intake workflow
  id `c6tgJmzSkxtsXTwb`; error workflow `OOfJPijdq1s08DQ9`; CRM credential in n8n
  `NYM0XzeLNTCwTydL`; webhook secret in `Form Intake Secret` credential.
- Railway CLI is authed (MCP token expired — use CLI). Push to `main` = auto-deploy
  (needs explicit user approval each time).
- **Always clean up test records** (people/activities/opportunities/consents) after
  smoke tests, filtering on a test marker.
- Build any new CRM hook under `packages/twenty-server/src/modules/enso/…`, register
  it in `workspace-query-hook.module.ts`, read reference data with
  `buildSystemAuthContext` + `shouldBypassPermissionChecks`, and set
  `position` + `createdBy`/`updatedBy` (SYSTEM actor) on any raw ORM insert.
