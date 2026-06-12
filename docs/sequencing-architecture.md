# Sequencing engine — consolidated architecture

The canonical design for how ENSO drives a claimed lead through the pipeline. This
supersedes the design-era `content/docs/*` material (which was speculative). It is
built on the signal map in [`channel-observability.md`](./channel-observability.md)
and the live build log in
[`sequencing-social-lead-claimed.md`](./sequencing-social-lead-claimed.md).

## Philosophy

- **Automate every transition the system can prove from a signal.** Ask the manager
  only for (a) actions only a human can take (send the message, make the call) and
  (b) facts only a human knows (the qualification).
- **The manager's reported `outcome` is the backbone signal**, because most channels
  are inbound-blind (calls off-app, personal WhatsApp/SMS, corporate SMS). Passive
  auto-detection is the *bonus* we get only on inbound-observed channels (mirrored
  social, all email, corporate WhatsApp, inbound calls). See `channel-observability`.
- **Minimise manager activity.** Every forced field is friction; force the fewest
  that earn their place, and only at the moment they're needed.

## Two machines, kept separate

1. **The cadence engine** — gets a claimed lead to `Connected`. Touches on a schedule
   + a silence safety-net (stall → grace → auto-close Unreachable). This is the
   Apollo/Outreach/SalesLoft-style core. It manufactures the *signal* that a gate
   needs (contact made). Already built (the backend scanner).
2. **The gated stage machine** — governs pipeline progression
   (Connected → Deep Qualification → Demo → …). Required fields gate each forward
   step. This is where the manager's qualification data goes. New work.

Keeping them separate is what prevents the old Outcome/Disposition/Result confusion.

## The task model — two concepts, no third

| Field | Values | Meaning | Set by |
|---|---|---|---|
| `status` | To do → (In progress) → Done | did the manager perform the step | manager, always |
| `outcome` | see below | what the step produced — the signal that moves the deal | manager, **or** auto from an observed inbound, **or** time |

Proposed `outcome` option set (spans call + messaging, maps to one action each):

| Outcome | Action |
|---|---|
| `No answer` (incl. voicemail) | cadence continues to the next touch |
| `Reached` | establish contact → fill `first_contact_*`, advance to Connected (through the gate) |
| `Callback requested` | contact established → Connected **+** schedule a follow-up task |
| `Not interested` | Closed Lost (reason: Not Interested) |
| `Wrong number` | Closed Lost (reason: Wrong Number) |
| `Bought elsewhere` | Closed Lost (reason: Bought Elsewhere) |

`outcome` is null until there's a result. On inbound-observed channels the engine may
fill it (or just auto-advance) without asking; on inbound-blind channels the manager
sets it when completing the touch.

## How a deal reaches Connected

`Connected` = two-way human contact. It requires two fields: **`first_contact_at`**
and **`first_contact_channel`**. They get filled one of two ways, both feeding the
same gate:

- **Auto-detect** (inbound-observed channels): the engine sees the lead's inbound
  (a reply, or the first inbound call), fills `first_contact_at` = the inbound time,
  `first_contact_channel` = that channel, and advances. No manager action.
- **Manager outcome** (inbound-blind channels): the manager marks the touch
  `Reached` / `Callback requested`; the engine fills `first_contact_at` = the touch
  time, `first_contact_channel` = the touch's channel, and advances.

## The stage gate (lock the steps)

Two hard rules on the stage field, **scoped to Connected for now**:

1. **No skipping** — a deal can move forward only to the immediately-next stage.
2. **No advance without that stage's required fields.**

Three doors to a forward move, one gate — they must never be redundant for one event:

- **Manager drags the stage** → fields present: moves. Missing: a **popup** lists the
  required fields with inline inputs; filling them completes the move. (Universal
  override.)
- **Fields get filled** → auto-advance, *only for Connected* (its fields literally
  *are* its definition, so it's not a surprise). Not extended to later stages, where
  advancing is a judgement call.
- **Task outcome** → on inbound-blind channels the `Reached` outcome is the contact
  proof; it fills the fields and advances. (Not a competing trigger — it's the
  channel-appropriate signal source.)

Enforcement lives in two new surfaces (this is **not** the scanner):
- **Frontend popup** — intercept the stage change on the deal record; if required
  fields are missing, show them with inline inputs.
- **Backend guard** — a `beforeUpdate` hook on the opportunity that rejects an
  illegal transition (skip, or missing fields), so the rule holds via API/import too.
  The engine's auto-advance flows through this same guard — one set of rules for
  humans and the engine alike.

Required fields per stage (from the real pipeline; only Connected enforced now):

| Transition | Required fields | Who fills |
|---|---|---|
| Lead Claimed → Connected | `first_contact_at`, `first_contact_channel` | engine (observed) or manager outcome |
| Connected → Deep Qualification | qualification fields (e.g. sale/lease, type) | manager (human knowledge) |
| Deep Qualification → Demo | demo scheduled at + type | manager (or calendar integration) |
| any → Closed Lost | lost reason | manager, or engine = Unreachable on silence |

## The engine (backend scanner, every minute — built)

1. **Enroll** claimed deals — weighted A/B variant, channel-gated, forward-only
   (only deals claimed after the go-live cutoff).
2. **Cadence** per channel — social: messages at 0/+1d/+3d; call: call attempts.
3. **Auto-advance on observed signal** — inbound contact → fill `first_contact_*` →
   Connected (through the guard).
4. **React to manager outcome** — `Reached`/`Callback` → Connected; the disqualify
   outcomes → Closed Lost + reason; `No answer` → next touch.
5. **Give up on silence** — stall → 7-day grace → auto-close Unreachable.
6. **Keep tasks pinned + stamped** (variant, channel) on the deal + contact.

## Channels

One engine, channel-parameterised. What differs per channel: the touch template
(message vs call) and the contact-signal source (observed inbound vs manager
outcome — see `channel-observability`). State machine + gates are shared.

## A/B variants

`sequence` rows = variants (slot = channel × stage × state, a `weight`, a `variant`
tag). The engine weighted-picks at enrollment; the variant is stamped on the run and
every task, so all metrics — including the per-step funnel — group by variant for
free. Add a variant by adding a row; no code.

## Build status

- **Built & live:** the cadence engine (enroll, cadence, stall/close), auto-detect
  Connected on social inbound (reply observer), channel detection + gating, task
  pinning, weighted A/B, forward-only + explicit-origin enrollment guards.
- **To build:** task descriptions (`bodyV2`) with step guidance + the "final touch"
  framing; due dates (`dueAt`); the clean `outcome` option set + the outcome→action
  reaction (esp. for inbound-blind channels); the Connected **stage gate** (popup +
  backend guard, one-step lock); the call channel; field grouping on the new objects.

## Open questions

- Exact qualification fields for Connected → Deep Qualification (the real CRM field
  names vs the design-era `sale_lease` / `real_estate_type`).
- Whether outbound-only signals (corporate SMS, app-dialed calls) are logged as
  timeline activities even though they never auto-advance the stage.
