# Manual lead entry — design

Managers find leads in many places (referrals, walk-ins, events, their own network,
calls to a personal phone). This is the one place in the CRM where they add them.
Status: **designed, not built** (2026-10-06).

## Principle

A manually added lead is a **manual inbound activity**, never a hand-made deal.
Attribution belongs to the activity (see the attribution-decoupled rule), and the
activity path already gives naming, person first-touch, timeline, consent, the
attach-vs-create deal rule (no duplicate open deal per person × project) and routing.
A deal created from "+ New" gets none of that — no name, project, routing, attribution
or sequence — and with scoping on, a Sales Manager may not even see it afterwards.

## Decisions (user, 2026-10-06)

1. **One entry point in the CRM** — a "New lead" launcher in the navigation drawer,
   next to "Log activity". Where the lead came from is answered inside the form.
2. **Marketing owns the source list** — offline sources and events are CRM records
   marketing edits, no deploy (same idea as `project.utmCampaigns`).
3. **Highest starting stage = Connected for now.** Later stages get unlocked by
   configuration; starting at a stage requires that stage's fields at intake (below).
4. **The manager chooses where the lead goes** — keep it, send it to routing, or hand
   it to a specific colleague.

## The form

**1. Contact + duplicate check.** Phone/email/name. Before creating anything, a
`checkLeadDuplicate` query runs the person-merge matcher (`phoneShortlistSuffix` +
`arePhonesSameLine`, plus email) for every role and returns the masked lookup
projection. Mine → reuse. Owned by another manager on this project → stop, show the
owner (the existing assignment wins, as everywhere else). None → create. Without this,
the async merge folds the new contact into the oldest match, possibly another
manager's.

**2. Project** — required.

**3. Source** — "How did this lead reach you?", options from marketing's list. Each
option carries opportunity `source` (REFERRAL / WALK_IN / MANUAL), `trafficType` and
utm slugs; managers never type utm text. Referral asks for the referring person or
company. Plus first-contact date (defaults to now, can be backdated) and channel.
Every manual activity is marked **self-reported** so BI separates declared from
measured attribution.

**4. Starting stage + its required fields.** The form asks for the cumulative
required fields of every stage up to the chosen one, read from a **single shared
stage-requirements constant** — the same one the stage gate (drag popup + backend
guard) uses. Starting at a stage without its fields would make manual entry the way
around the gate, so intake must ask for them.

| Start at | Required |
|---|---|
| Lead Claimed | — |
| Connected | firstContactAt, firstContactChannel (prefilled from step 3) |
| Deep Qualification (later) | qualification fields — not defined yet (Victor list) |

**Consent:** manual entry grants none. Optional per-channel "client agreed to be
contacted" checkboxes record VERBAL consent via the person-project-consent service.

## Where it goes

| Choice | Owner | Stage | Notes |
|---|---|---|---|
| Keep it (default) | creator | chosen (≤ Connected) | sticky person×project assignment written |
| A specific colleague | that manager | Lead Claimed | they haven't talked to the lead yet; notify them |
| Routing | project pool | Routing | stage choice hidden; first-contact info stays on the activity |

Routing is globally off today (empty/offline pools) — a routed lead parks until a
pool member is available; the form must say so. A contact already owned by another
manager on the project is blocked regardless of the choice.

## Sequencing

New kind `MANUAL_ENTRY` maps to a channel from step 3 (scanner skips deals with no
mappable inbound kind). A lead starting at Lead Claimed also gets a "First contact"
task due today until call/form cadences exist.

## Build order

1. ✅ Shared stage-requirements constant + backend stage guard (first half of gating) —
   `src/modules/enso/deal-stage-gate` (#328).
2. ✅ Metadata, applied to production 2026-10-06 by
   `scripts/provision-manual-lead-entry.mjs` (#329): inboundActivity kind
   `MANUAL_ENTRY`, source `MANUAL`, `isSelfReported`, `enteredBy`, `referredByPerson`
   / `referredByCompany` / `referredByName`, `manualLeadSource`; the marketing-owned
   `manualLeadSource` object (6 seeded rows, utm blank for marketing).
3. ✅ Backend — `src/modules/enso/manual-lead`:
   - `ensoManualLeadDuplicateCheck(input)` — NEW / REUSE / BLOCKED with a masked
     match, person-merge phone rule + exact email, 100 checks/manager/day.
   - `ensoCreateManualLead(input)` — idempotent on `requestId` (stored as the
     activity's `sourceExternalId`); refuses a contact another manager works on the
     project; creates or completes the person, writes the MANUAL_ENTRY activity
     (utm from the source, verbal consent channels in `submittedPayload`), queues
     attribution, resolves the deal synchronously with an initial owner + stage
     (or routing), then: marketing-room post, routing job, first-contact task for a
     Lead Claimed start, Google Chat notice to a colleague it was handed to.
   - Sales Managers' direct `opportunity.createOne/createMany` is refused.
   - Pipeline: REFERRAL / WALK_IN source from the manual source's category (deal +
     person first touch); VERBAL consent limited to the ticked channels.
   - Known gap: a B2B contact (work email) can attach to another manager's open
     company deal through the company dedup, which the duplicate check does not see.
4. Frontend "New lead" launcher.
5. Done = real managers' leads reaching Connected, not a synthetic test.
