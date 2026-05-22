---
title: State machine
description: Deal stage transitions, validation gates, automatic rollback. Replaces Tracking Deal Progress by Status.
---

# State machine

The Deal stage is a finite state machine. Each transition has:
1. **A trigger** (event or manual action)
2. **A set of required fields**
3. **A side-effect set** (write timestamps, clear downstream, emit event)

If required fields aren't filled, the transition either **fails open** (creates a validation_gate task and stays in source stage) or **rolls back** (matches today's behavior).

## States

```
Routing
  → LeadClaimed (on owner assigned + first interaction recorded)
  → ClosedLost (manual, with lost_reason)

LeadClaimed
  → Connected (on first_contact_at + first_contact_channel set)
  → ClosedLost

Connected
  → DeepQualification (on sale_lease + real_estate_type set)
  → ClosedLost

DeepQualification
  → Demo (on demo_scheduled_at + demo_type set)
  → ClosedLost

Demo
  → Contracting (on a deal_units row with role=confirmed)
  → ClosedLost

Contracting
  → ClosedWon (on 1C webhook signaling contract signed)
  → ClosedLost

ClosedWon, ClosedLost → terminal
```

## Transition table

| From | To | Trigger | Required fields | On missing |
|---|---|---|---|---|
| `Routing` | `LeadClaimed` | Owner assigned + interaction logged | none | — |
| `LeadClaimed` | `Connected` | Manual or auto on first interaction with status delivered/replied | `first_contact_at`, `first_contact_channel` | Create `validation_gate` task; deal stays in `LeadClaimed` |
| `Connected` | `DeepQualification` | Manual | `sale_lease`, `real_estate_type` (at least one) | `validation_gate` task |
| `DeepQualification` | `Demo` | Manual or on `demo_scheduled_at` set | `demo_scheduled_at`, `demo_type` | `validation_gate` task |
| `Demo` | `Contracting` | Manual after demo + unit confirmed | `deal_units` row with `role='confirmed'` | `validation_gate` task |
| `Contracting` | `ClosedWon` | Webhook from 1C: contract signed | none | — |
| any non-terminal | `ClosedLost` | Manual with reason | `lost_reason_id` | Required popover before commit |

## Pipeline state — orthogonal to stage

Same as today's `pipeline_state`. Pure attribute, no transitions to validate:

```text
pipeline_state ∈ {active, deferred, stalled}
```

State changes are logged but don't gate stage transitions. They are governed by:

- **active → stalled** — auto, when last_activity > 14 days AND no future task scheduled
- **active → deferred** — manual, when manager sets a future task >14 days out
- **deferred → active** — auto, when the deferred task fires
- **stalled → active** — auto, when a new inbound activity arrives, or manager engagement

## The state log

```text
deal_state_history
├── id (uuid)
├── deal_id (fk)
├── from_stage (nullable for initial insert)
├── to_stage
├── from_pipeline_state (nullable)
├── to_pipeline_state
├── transitioned_at (timestamptz)
├── transitioned_by_user_id (fk, nullable — null for system)
├── reason (text, nullable) — for rollbacks, system-initiated changes
└── created_at
```

The "current state" of a Deal is the latest row for that deal. Computed views derive:
- `time_in_stage` (now() - last transition into current stage)
- All the `timestamp_*` per-stage values (today stored as text fields)
- `stall_count`, `deferred_count`, `reactivated_count` (today as text fields)

## Validation gates instead of rollback

Today's `Tracking Deal Progress by Status` rolls the stage back if required fields are missing, then comments at the manager. Annoying UX — the manager's stage-advance click silently undoes itself.

Two options for the rebuild:

**Option A — same rollback** (matches today, less surprising for users coming from Attio):
- Stage advance happens
- Server validates; if missing fields → revert stage in same transaction
- Toast: "Stage rolled back: fill {fields} to advance"

**Option B — validation gate task** (cleaner, fewer flickers):
- Stage advance click validates synchronously *before* commit
- If valid → advance
- If not → don't advance, create a `validation_gate` task: *"Fill {fields} to advance to {stage}"*
- Manager can fill and click again, or save partial work

→ **Recommend B**. Matches the "tasks are the unit of work" framing.

## Auto-advance on signals

Some transitions auto-advance based on system events:

| Signal | Effect |
|---|---|
| First outbound `interaction` with `status='replied'` or `delivered` | If stage = LeadClaimed and `first_contact_at` is null → set `first_contact_at = interaction.occurred_at`, `first_contact_channel = interaction.kind_to_channel()`, advance to Connected |
| `demo_scheduled_at` set on Deal | If stage = DeepQualification → advance to Demo |
| `deal_units` row with `role='confirmed'` created | If stage = Demo → advance to Contracting |
| Webhook from 1C: contract signed | If stage = Contracting → advance to ClosedWon, fill `value_eur`, `closed_at` |

Auto-advance is gated by validation. Manual override is always available.

## Engine implementation

A small reducer-style engine in the backend:

```ts
function canTransition(deal: Deal, from: Stage, to: Stage): { ok: true } | { ok: false, missing: string[] } {
  const rule = TRANSITION_RULES[`${from}->${to}`]
  if (!rule) return { ok: false, missing: ['invalid transition'] }
  const missing = rule.requiredFields.filter(f => isEmpty(deal[f]))
  return missing.length ? { ok: false, missing } : { ok: true }
}

async function transition(deal: Deal, to: Stage, by: User, reason?: string) {
  const check = canTransition(deal, deal.stage, to)
  if (!check.ok) {
    await createValidationGate(deal, to, check.missing)
    return { advanced: false, validationGate: true, missing: check.missing }
  }
  await db.transaction(async tx => {
    await tx.update(deal).set({ stage: to })
    await tx.insert(dealStateHistory).values({ ... })
    await tx.update(tasks).set({ archived: true }).where({ deal_id: deal.id, kind: 'validation_gate', for_stage: to })
    await emitEvent('deal.stage_changed', { deal, from: deal.stage, to })
  })
  return { advanced: true }
}
```

Tests are trivial: a table of `(initialState, action, expectedNewState, expectedFailureMode)` rows.

## What today does that we keep

- Per-stage required-field validation
- Auto-write of timestamps on each transition (now via `deal_state_history`, not text fields)
- Clear-downstream behavior (today: clear `timestamp_*` of later stages; rebuild: implicit since `deal_state_history` is event-source and queries already filter by current stage)
- Rollback semantics (option A) **or** validation gates (option B)

## What today does that we drop

- 91 n8n nodes implementing the per-stage logic
- 11 text timestamp fields on Deal (`timestamp_routing`, ..., `timestamp_closed_lost`)
- Imperative "clear timestamp X if going back" code paths
- Stage-rollback as a way to coerce data entry (replaced by validation gates with visible UI)
