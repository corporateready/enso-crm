# Activity logging & task action surface — architecture

How a manager records what happened on a touch, and how that turns into signals
the pipeline acts on. This is the canonical design for the **task action surface**
(the per-task widget) and the **outcome model** behind it. It builds on the signal
map in [`channel-observability.md`](./channel-observability.md) and sits under the
[`sequencing-architecture.md`](./sequencing-architecture.md) engine.

It supersedes the single-`outcome` sketch in `sequencing-architecture.md` §"The task
model" — that conflated two layers; see "Two outcome layers" below.

## Governing principle

> **The widget asks the manager only for what the system genuinely cannot see.**

Everything routed through our infrastructure reports itself — a sent SMS, a sent
email and its bounce, a placed call with its duration and recording, an inbound
reply. So the manager is never asked to log "I sent it" or "I called." They are
asked for exactly two things:

1. **The disposition of a live call** — the human result (reached / no answer /
   voicemail …), which no automatic signal provides in real time.
2. **Anything done off our infrastructure** — a call from a personal handset, a
   personal WhatsApp/SMS — where nothing reaches us at all.

Everywhere the channel is observed, the surface degrades to a launch button plus an
auto-updating status. Less to do is the goal; force the fewest fields that earn it.

## The two axes everything hangs on

**Outbound capture** — can the system record that the touch happened, on its own?
**Inbound observability** — can the system see the lead's response, to infer the result?

| Channel | Outbound capture | Inbound observable |
|---|---|---|
| Social DM (IG/FB, via Chatwoot) | Auto | Yes |
| Corporate / group email (Chatwoot) | Auto | Yes |
| Personal email (only if inbox connected) | Auto | Yes |
| Corporate WhatsApp | Auto | Yes |
| Call — from CRM (web, callback, call-center/SIM) | Auto (event + duration + recording) | Recorded — disposition recoverable from the recording |
| Corporate / group SMS | Auto (send + delivery receipt) | Blind (no reply path) |
| Call — personal handset | Manual | Manual |
| Personal WhatsApp | Manual | Manual |
| Personal SMS | Manual | Manual |

Calls are never truly "blind": every call (any method) is recorded, so the event is
always captured and the disposition is recoverable from the tape later (manually
now, AI-on-recording eventually). The only thing not automatic *in real time* is the
disposition — which is why a call task always asks for it.

## On-system vs off-system is a mode, not a task type

A manager can act through our infrastructure (**on system** — captured) or outside it
(**off system** — must be logged by hand). This is a **mode within each channel
task**, not a separate kind of task. Every Call, WhatsApp and SMS task carries both
modes on one widget; the method the manager picks decides whether capture handles it
or the manual log appears. (Message tasks — social DM, email — are on-system only.)

## Two outcome layers — task outcome ≠ deal outcome

The single biggest correction from the design conversation: these are different
things and must not share a field.

**Layer 1 — task outcome** (the result of the *touch*; about reachability; lives on
the task). Answers "did I make contact?"

**Layer 2 — deal outcome / disposition** (the *lead's* status; lives on the deal as
its stage + `lostReason`). Answers "where does this lead now stand?"

A single touch can write **both**: you *Reached* them (task outcome) and learned they
*bought elsewhere* (deal outcome → Closed Lost). They are orthogonal — you can reach
an interested lead, reach a dead one, or not reach anyone. The deal disposition is
**never a task button**; it's a separate control on the deal.

| Layer | Field | Drives |
|---|---|---|
| Task outcome | `task.outcome` (reachability only) | cadence + advance to Connected |
| Deal outcome | `opportunity.stage` + `lostReason` | pipeline progression / closure |

The current built `task.outcome` (6 values mixing both layers) is wrong and must be
split: task outcome shrinks to the reachability set; the disqualifying values
(`NOT_INTERESTED`, `BOUGHT_ELSEWHERE`) move to the deal disposition.
(`WRONG_NUMBER` is the one boundary value — a failed-contact reason at the task layer
that can also disqualify the deal.)

## Task outcome catalog — by task type and stage

Two structural facts shape every set:

- **Synchronous vs asynchronous.** A call yields its result instantly (reached, no
  answer, busy, voicemail). A message yields only "sent" → a *waiting-for-reply*
  state; on observed channels the real result arrives automatically (reply observer),
  so it is never a manual button.
- **Pre-contact vs post-contact.** Before Connected the task is "make contact" →
  outcomes are about reachability. After Connected the task is "advance the deal" →
  outcomes are about progression.

Each outcome maps to a **next state** — that's what the cadence acts on.

### Pre-contact (Lead Claimed → reaching)

**Call task** — synchronous, widest set:

| Task outcome | Next state |
|---|---|
| Reached (spoke, two-way) | → Connected |
| No answer | retry — next cadence step |
| Busy | retry — short delay |
| Voicemail left | waiting for callback |
| Wrong / bad number | flag bad contact (may disqualify the deal) |
| Wrong person / gatekeeper | retry — find the right contact |
| Callback scheduled | schedule the next call task |

**Message task — social DM / email** — observed; the reply observer does the work:

| Task outcome | Next state |
|---|---|
| *(sent — automatic, not a button)* | waiting for reply |
| *(reply received — automatic)* | → Connected |
| Couldn't send (blocked / no account) | try another channel |

**WhatsApp task** — on-system mode behaves like Message (observed); off-system mode is
a manual log (sent / replied / notes).

**SMS task** — on-system: send + delivery captured, **no reply path**, so it never
auto-resolves and any answer arrives via another channel; off-system: manual log.

### Post-contact (Connected and beyond → advancing)

Reachability is moot; outcomes converge on a small, channel-agnostic progression set:

| Task outcome | Next state |
|---|---|
| Done / sent | advance the activity |
| Awaiting their response | waiting |
| Rescheduled / postponed | reschedule |
| No-show (missed scheduled call/meeting) | re-engage |

## The four task widgets

One channel-aware widget (`TASK_ACTIONS`) renders one of these layouts by
`task.channel`. Styling follows Twenty's surface tokens (white card, 0.5px borders,
`border-radius-lg`, info-tinted primary actions, secondary outline for off-system,
muted section labels). On-system actions are info-filled; off-system actions are
outline with a device icon and reveal the manual log.

### 1. Call task
- **On system · captured:** `[Call from web]` (WebRTC), `[Request callback]` (two-way
  originate — manager's phone rings, then bridges to the lead).
- **Off system · log it:** `[Start call manually]` (you dial; nothing captured).
- **Disposition (required for every call):** Reached · No answer · Busy · Voicemail ·
  Wrong number · Callback set. (Reached → Connected.)
- **Footer:** deal disposition is set on the deal, separately — not a task button.

### 2. Message task (social DM · email)
- Always on-system. `[Open conversation]` + a live `Waiting for reply` status.
- No outcome entry — send and reply are captured; a reply auto-advances to Connected.

### 3. WhatsApp task
- **On system · observed:** `[Open corporate chat]` + `Waiting for reply`.
- **Off system · log it:** `[Open on phone]` + a notes field (sent / replied / what
  they wanted).

### 4. SMS task
- **On system · one-way:** `[Send corporate SMS]` → `Delivered` (delivery captured;
  no reply to observe).
- **Off system · log it:** `[Send manually]` + a notes field.

## What every completed touch produces

Regardless of widget, completing a touch writes:

1. An **`outboundActivity`** — the durable record of the touch (channel, `loggedVia`,
   body/notes, `occurredAt`, duration/recording when captured), linked to the **task,
   the deal, and the person**. Auto-created from capture on system methods; created
   from the manual log on off-system methods.
2. Optionally a **task outcome** (reachability) — required for calls, auto/none for
   observed messaging.
3. Never a deal disposition from the task — that's set on the deal.

### Known defect this design fixes
The shipped widget links the activity via `task.sequenceRun.opportunityId`, which the
record fetch doesn't return → activities are created with `opportunityId = NULL` and
no person link (confirmed: a real manual log landed orphaned from its deal). The fix:
resolve the deal + person from the task's `taskTarget` pin (reliable), set both on the
`outboundActivity`. Done as part of building the off-system manual path.

## Build order

1. **Off-system manual path** inside each widget — pure frontend, no telephony
   dependency, and it carries the deal/person-link fix.
2. **Message + observed WhatsApp/email** — wire the existing reply observer into the
   surface (status, auto-advance).
3. **On-system call + corporate SMS** — `[Call from web]` / `[Request callback]` /
   `[Send corporate SMS]` depend on the telephony provider (Zadarma originate +
   WebRTC) and an SMS gateway; gated on a feasibility check.

## Open / deliberately deferred

- Final call disposition set (above is the working list).
- Whether the deal disposition is a dropdown on the deal vs a stage-gate required
  field (lives in `sequencing-architecture.md`'s gated-stage machine).
- AI-derived call disposition from the recording (recoverable, not real-time).
