# Channel observability & the "connected" signal

The real, as-operated model of which communication channels ENSO can observe, and
in which direction. This matters because it decides **where the sequencing engine
can detect contact automatically vs. where it must rely on the manager's reported
outcome** on a task.

## Principle

`Connected` means the lead engaged in two-way human contact. The engine can
auto-advance a deal to `Connected` **only where it can observe the lead's inbound
engagement** (a reply, or an inbound call). Outbound-only visibility ("we sent it,
can't see a reply") logs activity but does **not** prove connection — sending ≠
connected. Wherever we can't see the lead come back, the manager's **outcome** on
the touch is the signal that establishes contact.

## Signal map

| Channel | Inbound (lead → us) | Outbound (us → lead) | `Connected` detected by |
|---|---|---|---|
| Social DM — Instagram / Facebook via Chatwoot | tracked | tracked (manager replies in Chatwoot) | **auto** — inbound reply |
| Email — corporate / group (same thing) | tracked | tracked | **auto** — both sides seen |
| Email — personal | tracked | tracked | **auto** — managers are *required* to connect their mailbox |
| WhatsApp — corporate | tracked | tracked | **auto** — inbound reply |
| WhatsApp — personal | — | — | **manager outcome** |
| Phone — inbound to a corporate number (call center) | tracked (+ recording) | — | **auto** — the inbound call *is* the contact |
| Phone — outbound via the call-center app (group/corporate numbers) | — | tracked (+ recording) | system-logged; result via outcome |
| Phone — outbound from a recording SIM (even a personal handset) | — | tracked (+ recording) | system-logged; result via outcome |
| Phone — plain GSM dial (personal phone, no app, no recording SIM) | — | — | **manager outcome** (we're blind) |
| SMS — corporate / group | **no — can't receive replies** | tracked (logged) | outbound logged only; connect needs outcome / a reply elsewhere |
| SMS — personal | — | — | **manager outcome** |

## Telephony detail

- Leads usually call the **corporate numbers** published on the website / social.
  The call enters the **call-center system** and is routed to a manager. **These
  inbound calls are tracked** (the number, plus a recording).
- A manager's **outbound** call is tracked **only if it goes through a tracked path**:
  - dialed from the **call-center app** (using group / corporate numbers), **or**
  - dialed from a handset whose **SIM card stores the recording** — this can even
    be the manager's *personal* phone, as long as it's that special SIM.
  - In the data this appears as either "outbound from the call-center app" or
    "outbound from a personal number on a recording SIM."
- If the manager uses a **plain regular personal phone and dials directly over GSM**
  (not through the app, no recording SIM), **there is no way to know a call
  happened.** → unobserved → the manager must report the outcome.

So for calls the determinant is **not** corporate-vs-personal handset — it's
**whether the call went through the app or a recording SIM.**

## Consequence for the engine

- **Auto-detect `Connected`** is possible on: mirrored social inbound, all email
  (corporate, group, and personal — managers are required to connect their mailbox,
  so personal email is observed too), corporate WhatsApp (inbound), and the first
  inbound call.
- **Manager outcome required** on: calls not placed through the app / recording SIM,
  personal WhatsApp, personal SMS, and corporate/group SMS (outbound-only — we log
  that it went out but can't see a reply).
- `first_contact_channel` records whichever channel established contact; the engine
  fills it (+ `first_contact_at`) when it auto-detects, or it's derived from the
  manager's outcome touch when reported.
- "Log everything we can see; advance only on inbound engagement or a reported
  outcome" — outbound-only signals (corporate SMS, app-dialed calls) become timeline
  activity but never auto-advance the stage on their own.
