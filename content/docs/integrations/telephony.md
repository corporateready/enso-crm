---
title: Telephony
description: Inbound calls — Moldcell PBX (programmable, MD) + Zadarma (RO) + Roistat as the attribution layer. Real-time routing and post-call ingest are two separate modules.
---

# Telephony

Three players, and the division of labour matters:

- **Moldcell Virtual PBX** (MD) — the call-truth source. Who is ringing, who answered, how long, the recording. **Programmable** (see below).
- **Zadarma** (RO) — same role for +40 numbers.
- **Roistat** — the attribution layer in front of both. It owns the marketing→call linkage (campaign, UTM, keyword, project) and nothing else.

Roistat can tell us *where a call came from*. Only the PBX can tell us *who should answer it and who did*. Those are different questions, and they are answered by two different modules.

**Status: not built.** This document is the design of record plus the measured
state of the legacy stack. Earlier versions of this page claimed
"Shipped (intake)", a `telephony-zadarma` NestJS module, and a
`POST /api/intake/call` endpoint — **none of those ever existed**. See
[Legacy reality](#legacy-reality-measured-2026-08-25) for what is actually running.

## Correction: Moldcell is not a black box

The previous design was built on the premise that Moldcell had no public API, so
Moldcell calls could only be observed indirectly through Roistat. **That premise
is false**, and it is why real-time routing was considered impossible for years.

Moldcell Virtual PBX is a white-labelled **ITooLabs Communications Server** with
a full documented REST API (spec: `https://itoolabstest.pbx.moldcell.md/media/admin/pdf/crm_rest_api.pdf`,
17 pages, RU only; wiki `https://wiki.pbx.moldcell.md/crm`). Our tenant is
`enso.pbx.moldcell.md`. The legacy n8n stack already calls it, so it is proven in
practice.

Auth is HTTPS plus a single pre-shared token, bidirectional: CRM→PBX requests
send `token`; PBX→CRM pushes carry `crm_token` so we can verify them. There is no
HMAC and no signing.

### PBX → CRM (pushes)

All pushes for one connector arrive at **one URL**, dispatched on `cmd`.

| `cmd` | When | Key fields |
|---|---|---|
| `event` | Real-time call signalling | `type` ∈ `INCOMING`/`ACCEPTED`/`COMPLETED`/`CANCELLED`/`OUTGOING`/`TRANSFERRED`, `phone`, `diversion` (DID dialled), `user`, `direction`, **`callid` (stable across all related legs)** |
| `history` | At hangup | `status` ∈ `Success`/`Missed`/`Cancel`/`Busy`/`NotAvailable`/`NotAllowed`/`NotFound`, `duration`, `start` (`YYYYmmddTHHMMSSZ`), **`link` = recording URL**, `callid`, `user` |
| `contact` | On each new inbound call, **while ringing** | Request: `phone`, `callid`. Response: `{contact_name, responsible}` → PBX can **auto-transfer to the responsible manager**, with a fallback if busy/unanswered |

### CRM → PBX (`POST https://enso.pbx.moldcell.md/sys/crm_api.wcgp`, `cmd=` + `token=`)

| `cmd` | Use |
|---|---|
| `makeCall` | Click-to-dial — rings the manager, then bridges to the client; returns CallID |
| `accounts` | PBX users → map to `workspaceMember` (login, `realName`, `ext`, `telnum`) |
| `groups` | Departments |
| `history` | CSV pull: `UID,type,client,account,via,start,wait,duration,record` |
| `subscribeOnCalls`, `set_dnd`, `get_dnd`, `subscriptionStatus` | Per-agent / per-department call reception — the PBX-side counterpart of `isAvailableForRouting` |

Multiple **API connectors** can coexist on one tenant, each with its own CRM
address and token. The CRM gets its own connector; the legacy n8n connector is
left untouched. Because `contact` auto-transfer is enabled **per number**, the
two connectors must not both steer the same numbers.

## Architecture: two modules, deliberately separate

Real-time routing and record creation have incompatible constraints. Keeping them
apart is the central design decision.

### Module A — Real-time call routing (during the ring)

Answers the PBX `contact` push. Synchronous, millisecond budget, **writes nothing**.

1. `phone` → Person → active `personProjectAssignment` (sticky owner)
2. Owner found → return `{contact_name, responsible}` → PBX rings that manager directly
3. No owner → return `contact_name` only → PBX falls through to its department queue

`isAvailableForRouting` is deliberately **not** consulted. It means "send me new
leads or not" — a load control over the ROUTING pool — not "do not connect my own
customers to me". An existing client ringing their own manager is not new work,
and diverting them to the department throws away the continuity sticky ownership
exists for. This matches the routing brain, which already holds that "sticky wins
even if the manager is currently offline — it's their client". Real presence
belongs to the PBX (DND / «Приём звонков»), whose mandatory fallback sends the
call to the department on no-answer.

Hard requirements: a strict timeout and a **safe fallback** — omitting
`responsible` must be the failure mode. A stall here delays a live call, so this
path must not sit behind heavy middleware or a shared job queue. It reads only;
it never creates a Person, Opportunity, or activity.

Sticky ownership therefore becomes real-time: a returning customer's call rings
the manager who owns them, before anyone touches the CRM.

### Module B — Post-call ingest (near real-time)

Everything else. Correlates the 3–4 events describing one call into a single
`inboundActivity`, then hands off to the existing pipeline unchanged.

- **Correlation key: Moldcell `callid`** — authoritative and stable across legs.
  Roistat's own call `id` and `visit_id` correlate onto it by (phone, ~10-min window).
- **Create early, patch later.** Create the `inboundActivity` on the first signal
  (`event INCOMING`, or Roistat at-call) so the lead exists within seconds, then
  patch outcome, duration, and recording as later events arrive. Waiting for the
  call to end before creating anything is what made the legacy design blind.
- **Who answered** comes from `event ACCEPTED`.`user` / `history`.`user`, mapped
  via `workspaceMember.pbxLogin`. Answered calls **auto-claim** to that manager.
  Missed calls (`status=Missed`, or a call whose only terminal push is
  `CANCELLED`) enter normal routing plus the claim window.
- **`event CANCELLED` is PER-LEG, not per-call.** When a call rings a department,
  every extension that does *not* win the race gets its own CANCELLED push naming
  its own user. Verified live: Alexandr answered on ext 722 while Denis's ext 704
  was cancelled. So no single terminal push knows how the call ended, and the
  pushes race each other over HTTP — deciding from whichever arrived first opened
  an answered department call in ROUTING with no owner.
  **The stage is therefore decided from the ACTIVITY, not from a push**, by
  `DecideCallOutcomeJob` a short settle delay (`ENSO_TELEPHONY_OUTCOME_SETTLE_MS`,
  default 20s) after the call ends: `history` has authority over the status, and
  `salesPickup` independently proves an individual accepted — which still holds if
  the `history` push never arrives.
- **Reconciliation sweep** catches calls whose terminal event never arrived
  (observed: 1 in 6 Roistat after-call events went missing).

Downstream is unchanged: `inboundActivity(kind=INCOMING_CALL)` →
[lead pipeline](../systems/lead-pipeline) → Person → Company → Opportunity →
[routing](../systems/routing) → claim.

### Module C — Outbound (post-call, no UI dependency)

The PBX reports outbound calls with the **same** `event`/`history` commands, only
with `type=out` / `direction=out`. So anything placed through the PBX is captured
whatever placed it: the CRM's own click-to-call, the Moldcell mobile app, a desk
phone, a softphone. The only call we cannot see is one made from a personal
handset on a personal SIM.

Outbound is a **separate object and a separate path**:

- Writes `outboundActivity(channel=CALL)`, never `inboundActivity`, and **never
  enters the lead pipeline** — a manager dialling a number is not a new lead.
- The contact is **looked up, never created**. We called a number; that says
  nothing about whether the number belongs in the CRM. An unknown number still
  logs the call, just without a person link.
- `loggedVia` distinguishes how the touch reached us: `CRM_INITIATED` (a button
  pressed here), `OBSERVED` (through the PBX from anywhere else), `MANUAL_LOG`
  (invisible to us, typed in), `CORPORATE_GSM` (recording SIM).
- Outcome uses the **manager-achievement** vocabulary (`REACHED` / `NO_ANSWER` /
  `BUSY`), not the phone-system vocabulary inbound uses (`ANSWERED` /
  `ABANDONED` / `CONGESTION`), so an observed call and a hand-logged one read
  identically.
- The deal is attached only when the contact has **exactly one open**
  opportunity. An outbound call carries no DID, no department and no Roistat
  record, so the contact is the only signal; guessing among several deals is
  worse than leaving the call on the contact.

### Recordings are copied into the CRM, not linked

The PBX keeps a recording for roughly a week, and — verified against a live
recording — serves it over an **unauthenticated URL**: anyone who ever sees the
link can listen to the call. So every recording is downloaded into the
workspace's own file storage and attached to the activity (`attachment`,
`fileCategory=AUDIO`). The PBX link stays on the activity as provenance; the
attachment is the durable, access-controlled copy.

The download runs as its own job, re-enqueued with a delay: the PBX writes the
audio *after* the call ends, so `history` regularly arrives before the file
exists. Giving up loses the durable copy, never the call.

**Requires object storage.** The archiver runs on `twenty-worker` and the
download is served by `twenty-server` — separate Railway deployments with
separate filesystems. Under `STORAGE_TYPE=local` the worker writes the audio
where the server cannot read it, and an unmounted Railway filesystem is wiped on
every deploy, so the result is attachment rows that look real and never play.
Archival is therefore gated on `STORAGE_TYPE=s3` and stays off until a bucket is
configured (`STORAGE_S3_NAME`, `STORAGE_S3_ENDPOINT`, `STORAGE_S3_REGION`,
`STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY`) — which the CRM needs
anyway for any attachment or avatar to survive a deploy.

### Why this collapses the legacy complexity

Every hard mechanism in the legacy stack is a workaround for *polling instead of
receiving*:

| Legacy workaround | Replaced by |
|---|---|
| 7s grace period + 3-probe retry ladder (~7s/32s/92s) | `event ACCEPTED` push |
| 1-minute rolling PBX poller | `event CANCELLED` / `history status=Missed` push |
| Synthetic `roistat_first`/`roistat_second` fabrication | `history` (authoritative status/duration/recording) |
| `call_merge:<phone>:<bucket>` heuristics, adjacent-bucket probing | `callid` |
| No real-time routing at all | `contact` |

## Roistat — attribution only

Project **187275**. API base `https://cloud.roistat.com/api/v1`, auth
`Api-key: <key>` header + `?project=187275`. Credentials: `ROISTAT_API_KEY`,
`ROISTAT_PROJECT_ID`.

### Two webhook slots per scenario

Both are configured today, on every scenario that has any webhook at all:

| Slot | Fires | Adds |
|---|---|---|
| `integration.webhook_start.url` | ~5s after call start | — |
| `integration.webhook.url` | at hangup | `status`, `duration`, `file_id`, `link` (recording) |

**Attribution arrives on both.** The at-call push already carries `custom_fields`
with the UTMs *and* `project_id`, so the project is known seconds into the call —
there is no need to wait for the call to end to identify or route a lead. Only
outcome fields are exclusive to the after-call push.

### `project_id` is configuration, not derivation

`project_id` is a hand-entered static value in
`integration.webhook.custom_fields`, alongside hardcoded UTMs and Roistat macros
(`{facebookClientId}`, `{roistatParam1..4}`, `{agent}`).

Two consequences:

- Adding or re-labelling a project is a **Roistat config change**, not a code change.
- `utm_medium: "static_call_tracking"` / `"dynamic_call_tracking"` is a **typed
  label, not a measurement**. Never infer the tracking mode from it.

Project codes: `ENS2301` ARTIMA · `ENS1901` Ioana Radu · `ENS2402` AVRAM IANCU ·
`ENS2101` AVENEW BOTANICA · `ENS2501` ENSO LIVING · `ENSVI` Vânzări Imobiliare.

> The legacy `Calls Workflow` maps `ENS1901` to "NEWTON House Buiucani". That
> label is **wrong** — `ENS1901` is Ioana Radu. Do not port that map.

### Both tracking types carry UTMs — via different slots

Roistat delivers attribution through **two** slots, and which one a field uses is a
per-scenario configuration choice, not a property of the field:

- **`custom_fields`** — the configurable payload. **Static** scenarios put
  *enforced* values here: a static number has no visitor session, so its UTMs are
  set once in Roistat against the scenario. This is the same mechanism that
  already carries `project_id`.
- **top level** — Roistat's own session-derived values on **dynamic** scenarios
  (`landing_page`, `referrer`, `ip`, `google_client_id`, …).

So intake reads **every** attribution field from `custom_fields` first and the top
level second. Reading one slot only would silently drop whichever type is
configured the other way. An enforced custom field wins a collision, because it is
a deliberate per-scenario decision.

`roistatVisitId` is how the two are told apart after the fact: null on static, set
on dynamic.

`trafficType` is **derived from `utm_medium`** (Roistat has no traffic-type
concept), using the same convention the Lead Ads intake already applies —
`utm_medium=paid_social` → `PAID` — so a call and a lead ad describing the same
campaign read alike. The deal copies it onto its first/last-touch snapshot.

### Static vs dynamic

133 scenarios: 124 static, 9 dynamic; 74 enabled. Dynamic is in real use —
Artima.md Dynamic (641 calls), ENSO Living dynamic website (113), Ioana Radu
dynamic call (108), Sarmizegetusa (9). Static attribution is channel-level;
dynamic adds session/keyword depth via `visit_id`.

A short traffic sample will look static-only. It isn't.

### Number inventory and topology

52 tracking numbers, **all `is_external: 1`** — ENSO's own numbers forwarded into
Roistat, not rented from Roistat. 38 MD (+373), 14 RO (+40).
`options.redirect.value` reveals the split:

| Redirect value | Meaning |
|---|---|
| `341771@sip.zadarma.com` (39 scenarios) | RO — into Zadarma SIP |
| `1@noneed.ru` (94 scenarios) | placeholder = no SIP redirect; MD numbers forwarded at operator level into the Moldcell PBX |

### ⚠️ Coverage gap — the largest source of call loss

Of the **74 enabled** scenarios:

| Destination | Scenarios | Calls |
|---|---|---|
| n8n (both hooks) | 39 | 1,521 |
| **No webhook at all** | **30** | **2,141** |
| RudderStack only | 5 | 864 |

**Only ~34% of tracked call volume on enabled scenarios even attempts to notify
us.** The blind scenarios are high-volume channels: Google My Business
botanica.newton.md (590), Facebook (466), Instagram (286), Marinacarnat (185),
Newton.md (150) — mostly Newton Botanica. A further 10 of the 39 webhooked
scenarios carry **no `project_id`**, so those calls arrive unattributed.

`readydvasbihce.dataplane.rudderstack.com` is an undocumented **RudderStack**
destination taking 864 calls; it appears in no other project document.

Repairing this is Roistat configuration (`calltracking/script/update`), not code —
but it only pays off once Module B exists to receive the traffic.

### Verification

Roistat does not sign its callbacks. Verify by a secret baked into the CRM webhook
path (`ENSO_ROISTAT_WEBHOOK_SECRET`) plus an IP allowlist — observed sender is
`167.235.14.14`, UA `Roistat Bot`.

## Legacy reality (measured 2026-08-25)

### The live call pipeline is dead

`Calls Workflow for Attio` (`vaqZSR5Z8KVTXrpI`, 127 nodes, **active**) is severed.
Across the entire retained execution history, **every run stops after 4 of 124
nodes and none reach Attio** — and every run is logged `success`, which is why
nothing alerted.

Cause: the chain is
`Incoming Call → Code Normalization1 → Redis Save Initial1 → Code Normalization → If5 → …`.
`Code Normalization` is a byte-identical copy of `Code Normalization1` but is fed
the **Upstash SET response** `{"result":"OK"}`. Its source detection tests
`json.query` and `json.body.body`, both miss, it `continue`s and returns `[]`.
`If5` has exactly one inbound edge, so nothing else can reach the chain.

Combined with the Roistat coverage gap, **net call capture is effectively zero**.
Calls still ring and are answered — telephony is independent of this — but they
leave no CRM trace and get no routing or sequence.

### Port from the newer workflows, not the live one

| Workflow | State | Why it matters |
|---|---|---|
| `Calls Workflow Missed Solution` (134n) | off, newest | The most mature design: MD grace period, PBX confirmation, retry ladder, missed-call poller with three anti-duplication guards, real terminal idempotency, synthetic-vs-real provenance |
| `Calls Workflow for Attio new` (44n) | off | Redis-hash state (no read-modify-write race), adjacent-bucket correlation, ack-then-process (202) |
| `Calls Workflow for Attio remake` (96n) | off | Intermediate step |

`Missed Solution`'s CSV parsing is the **correct** one — `parts[1]`=call type,
`parts[6]`=wait, `parts[7]`=talk — matching the official spec
(`UID,type,client,account,via,start,wait,duration,record`). The live parser is
wrong (treats `parts[6]` as talk, `parts[7]` as a status code) and infers
"answered" from `account` being non-empty, which is **invalid**: a group or IVR
appears in `account` even for unanswered calls.

Provenance fields worth preserving in the new model: `_synthetic`, `_source`,
`_synthetic_reason`, `delivery_source` — they distinguish a PBX-derived "missed"
from an analytics-confirmed one.

### Bugs not to port

- Redis key `call_merge:<phone>` (phone only) → cross-call contamination. With the
  dead `crm_sent` / `_finished_sources` / `already_sent` guards (read but never
  written), effective behaviour is **one activity per phone per 20 minutes**.
- Readiness asymmetry: MD required 2 events, RO required all 4.
- PostHog switch with outputs 3 and 4 both `ENS2101` → **Sarmizegetusa unreachable**.
- Fivetran nodes orphaned in every version — "analytical events flow live" is false.
- No E.164 normalisation (8 different snippets). A local `0XXXXXXX` fails both
  `startsWith('373')` and `startsWith('40')` → `country = null` → weakest path,
  no brand routing.
- Country derived from callee everywhere except one node that uses caller.
- Entry webhook has **no authentication** (the one attempt compares the secret
  against its own webhook URL).
- RO has **no missed-call handling at all** — every fallback is gated
  `country !== 'MD' → return []`.

### What gets retired

- `zadarma-signer.onrender.com` — folded into the CRM
- Upstash Redis call-dedup — replaced by Postgres keyed on `callid`
- The 127-node `Calls Workflow` and its three abandoned remakes
- Per-brand "Incoming Calls" flows — one path, brand from `custom_fields.project_id`
- Zapier in the Zadarma path (`zapier_first`/`zapier_second`)
- Test flows (`test-pbx-event`, `TEST Incoming Calls`)

## Configuration

| Variable | Purpose |
|---|---|
| `ENSO_MOLDCELL_PBX_BASE_URL` | `https://enso.pbx.moldcell.md` (path `/sys/crm_api.wcgp`) |
| `ENSO_MOLDCELL_PBX_TOKEN` | CRM→PBX token; minted per connector in the cabinet |
| `ENSO_MOLDCELL_CRM_TOKEN` | Echoed back as `crm_token` on every push; the only authenticity check |
| `ENSO_ROISTAT_WEBHOOK_SECRET` | Baked into the Roistat webhook path |
| `ROISTAT_API_KEY`, `ROISTAT_PROJECT_ID` | Roistat REST access (project 187275) |
| `ENSO_TELEPHONY_ARCHIVE_RECORDINGS` | Recording archival. Defaults ON only under `STORAGE_TYPE=s3`; `true` forces it, `false` disables it |
| `ENSO_TELEPHONY_RECORDING_MAX_BYTES` | Per-recording ceiling (default 20 MB ≈ a two-hour call) |

Set on Railway `twenty-server` (serves the endpoints) and `twenty-worker` (runs
the PBX lookup jobs).

## Rollout order

1. **Module B** — the receiver + correlation + `inboundActivity`. Stops the data loss.
2. **Repoint Roistat** at the CRM endpoint, then **repair the coverage gap** on the
   30 blind enabled scenarios and add `project_id` to the 10 missing it.
3. **Module A** — `contact` responder. Only after it is verified fast with a safe
   fallback should per-number "auto-transfer to responsible" be enabled in the
   cabinet, and only on numbers the n8n connector is not steering.
4. **Module C** — outbound ingest. No UI dependency: it captures calls placed
   from the Moldcell app and desk phones as soon as it ships.
5. **Click-to-call** via `makeCall` — shipped as ONE button, not two.

   `makeCall` is the only origination command the PBX exposes, and it is a
   two-legged callback: documented verbatim as "сначала звонок на телефон
   менеджера, а потом соединит его с клиентом" — it rings the **manager** first,
   then bridges the client. So "call from web" and "request a callback" were
   always the same mechanism, and the button says so ("your phone rings first").

   What does NOT exist, both checked:
   - **Browser audio.** WebRTC lives only inside ITooLabs' own first-party
     amoCRM / Kommo / Bitrix24 widgets. There is no JS SDK and no public
     endpoint; the cabinet's own WebRTC speaks a proprietary JSON-over-WebSocket
     protocol, not SIP. A desk-phone-free call needs an *installed* SIP client.
   - **A Moldcell app deep link.** Verified absent via Play, the App Store /
     iTunes lookup, `assetlinks.json`, AASA, the ITooLabs wiki, and other
     resellers. It is also unnecessary: the app's own «Перезвонить через АТС» IS
     the `makeCall` pattern, and calls placed in the app are captured by Module C
     anyway.

   No SIP device is required for `makeCall` either — where the manager's leg
   rings is their own «Приём звонков» setting. Cost caveat: it is billed as two
   legs, and the manager's leg is billed as outbound if it forwards to an
   external mobile.

   Gated on `workspaceMember.pbxLogin`: without it the PBX has no idea whose
   phone to ring, so the button is disabled with that reason shown.
6. **`set_dnd` / `subscribeOnCalls`** wired to `isAvailableForRouting`, so CRM
   presence and PBX call reception stop drifting apart.

## Open questions

- **Does the cabinet's "Адрес вашей CRM" field accept a full URL with a path?**
  The placeholder suggests a bare domain. If it is domain-only, the PBX will POST
  to a default path — and if that path is `/`, it collides with the frontend SPA
  that `twenty-server` also serves.
- **Where does the existing n8n Moldcell connector point?** The only n8n receivers
  of PBX pushes are two inactive prototypes, so those pushes are currently
  discarded.
- **RO parity.** Zadarma has the same webhook family
  (`notify_start`/`answer`/`end`/`record`); Module B should treat it as a second
  provider rather than a special case, so RO finally gets missed-call handling.
- **Do managers hold separate MD and RO extensions**, and should "who answered" be
  unified across them?
- **Should every inbound number be Roistat-tracked?** Untracked numbers are
  attribution-blind but, once the PBX pushes are wired, no longer
  *observation*-blind — which changes the old answer.
