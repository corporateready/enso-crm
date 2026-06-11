# Sequencing — Social Lead Claimed (working spec)

Status: **working design**, converged with user 2026-06-10. This is the reference for building the sequencing engine, starting with the social channel at the Lead Claimed stage. Other channels (form/lead-ad, call) reuse the same architecture with different cadences.

## Principles

1. **One task object.** We extend Twenty's native `task` (a customizable standard object) with custom fields. The *same* object is created automatically by a sequence and manually by a manager. No second "sequence step" object. A manual task is just one with no sequence link.
2. **Automation = task lifecycle, not messaging.** After the Meta-side bot's 1–2 messages, the system never messages the lead again. It **creates / schedules / reminds / advances / cancels** tasks; the **manager writes every message**. Follow-ups are manager tasks the system times, not auto-sent.
3. **Observe the thread, don't ask.** Social lives in Chatwoot. Replies, silence, channel, timestamps are read from the conversation — the manager never logs "no answer."
4. **Measure everything.** Every task carries which sequence/variant/step it came from, so "which sequence converts best" is a query. This is the whole point of the rich task object.
5. **The bot is Meta-side, not CRM.** The instant greeting + button flow runs as Meta-native automation (0-second response, and it sidesteps Chatwoot's inability to send button templates). The CRM owns routing, tasks, the funnel, and measurement. **Hard dependency:** the bot thread (bot messages + lead responses) must mirror into Chatwoot/CRM in real time, or reply-detection and timing break.

## The Social Lead Claimed lifecycle

**Goal of the stage:** establish a two-way *human* conversation. Nothing else.

```
Lead DMs
  ├─ Meta bot: intro "Hello, what can we help with?"   (everyone)         ← touch 1 (auto, Meta)
  │     ├─ taps a button → 1 more automated reply (2 auto msgs total)
  │     └─ writes free-text → no more automation (1 auto msg total)
  └─ Routing assigns a manager immediately (everyone, regardless of behavior)

Manager task sequence (the manager writes each one; system only creates/times them):
  Task 1  "send first personal message"   due = now      ← touch 2 (everyone gets a human)
  Task 2  follow-up                        due = +1 day   ← touch 3 (only if no reply)
  Task 3  follow-up                        due = +3 days  ← touch 4 (only if no reply) → then STALL
       4 touches total into the void (1 bot + 3 manager). Trimmed from 5 — DMs are intrusive.

Exit — Connected:
  lead replies to a MANAGER (not bot) message  →  CONNECTED (auto)
     set first_contact_at + first_contact_channel; cancel remaining tasks; advance stage
     "Connected" = a manager has sent ≥1 message AND the lead has ≥1 free-text reply (order-independent)

Exit — Stalled → Close:
  3 manager touches done, still no reply  →  STALLED (pipeline_state)
     ~7-day grace, NO outreach — just watch the thread
       lead messages during grace → reactivate → Connected (auto)
       grace expires silent → AUTO-CLOSE: Lost / Unreachable (re-engageable; reopens on later inbound)
```

Total arc ≈ 3 days chase + 7 days silent watch ≈ 10 days claim→close. Any human reply at any point → Connected.

**Cadence values (Day0/+1d/+3d, 7-day stall) are the v1 default and the first A/B target — not gospel.**

## Data model

Four pieces. Clean separation: **Sequence = identity/definition**, **Workflow = the steps**, **Sequence Run = the per-deal enrollment + measurement unit**, **Task = the work unit**.

### 1. `task` (native, + custom fields)
- `sequence_run_id` (fk → sequence_run; null = manual task)
- `sequence_id`, `variant` (denormalized for fast analytics)
- `step_key` (e.g. `social.lead_claimed.msg1`, `.followup_1d`)
- `channel` (social/call/form)
- `is_auto_created` (bool)
- `outcome` (observed: `lead_replied` / `no_reply` / n/a) — for social, auto-set from the thread
- native: `dueAt`, `status`, `assignee`, `title`, `body`

### 2. `sequence` (custom object — one row per variant)
The definition of a sequence variant for a slot.
- `slot` = (`channel`, `stage`, `pipeline_state`) — e.g. `social / LeadClaimed / active`
- `label` (e.g. "Social LC — v1 (4 touches / 3d)")
- `workflow_id` — the Twenty workflow (canvas) that implements the steps
- `weight` (A/B allocation, e.g. 50)
- `is_active` (bool)

### 3. `sequence_run` (custom object — one row per deal-enrollment) ← the analytics unit
- `sequence_id` (+ `variant` denormalized), `deal_id`
- `enrolled_at`
- `ended_at`, `end_reason` (advanced / stalled / closed / superseded)
- `advanced` (bool), `advanced_to_stage`, `advanced_at`, `advanced_at_step` (which step the lead was on when they replied — powers the step funnel)
- One row = "deal X ran variant Y, result Z." Aggregate these for conversion. A deal can have multiple runs (Lead Claimed run, then a Connected run).

### 4. `deal_state_history` (transition log) — already specced
- `deal_id, from_stage, to_stage, transitioned_at, transitioned_by`
- Supplies time-to-advance and "did it advance." Also kills the Attio text-timestamp/counter fields.

## How it runs on Twenty native workflows

We reuse the native canvas (`CREATE_RECORD`, `UPDATE_RECORD`, `IF_ELSE`, `DELAY`, `FILTER`, `CODE`) and the executor's suspend/resume (the `DELAY` resume mechanism). Three moving parts:

**A. Dispatcher** (one workflow, trigger: deal `stage → LeadClaimed` + channel filter)
- `CODE` step: pick a variant by weighted-random among active `sequence` rows for this slot.
- Create a `sequence_run` (enrolled_at = now), stamp `sequence_run_id` + `variant` on the deal.
- Start the chosen variant's **cadence workflow**.

**B. Cadence workflow** (one per variant = the A/B arm; this is what you edit on the canvas)
```
[guard: deal.stage == LeadClaimed?  else STOP]
CREATE_RECORD task msg1 (due now, stamped with sequence_run_id/variant/step)
DELAY +1 day
[guard] CREATE_RECORD task followup_1d
DELAY +2 days
[guard] CREATE_RECORD task followup_3d
DELAY (to stall point)
[guard] UPDATE deal.pipeline_state = stalled
DELAY +7 days
[guard] UPDATE deal.stage = ClosedLost, lost_reason = Unreachable; close sequence_run(end_reason=closed)
```
The **guard** (`IF deal.stage != LeadClaimed → stop`) is how the run self-terminates the instant the deal advances — no forced cancellation needed.

**C. Reply observer** (one workflow/hook, trigger: inbound social message)
- `IF` deal is in LeadClaimed AND a manager has sent ≥1 message → `UPDATE` deal.stage = Connected, set first_contact fields, close `sequence_run(advanced=true, advanced_at=now)`.
- The cadence workflow's next guard then sees `stage=Connected` and stops on its own.

The bot's messages are Meta-side and never trigger Connected — only a manager message + lead reply does.

## A/B split testing — the user's exact scenario

> Slot = social · Lead Claimed · active. Variant A = current (4 touches / 3 days). Variant B = "5 messages in 2 hours." Which converts better?

- Each variant is a **separate cadence workflow** (different canvas) + a **`sequence` row** pointing at it, same `slot`, `weight` (e.g. 50/50).
- The **dispatcher** assigns each new deal to a variant by weight, writes the `variant` onto the `sequence_run`, the `deal`, and **every task** the run creates.
- Because the variant tag rides all the way down to the task and the run, every metric groups by `variant` with no extra plumbing.
- To test a new idea (5-in-2h), you **clone the workflow, edit the canvas, add a `sequence` row, set weights** — no code change. To stop a test, set `is_active=false` / `weight=0`.

### The three metrics (per variant, one query each over `sequence_run` + `deal_state_history`)
*Conversion event = the sequence's success: **stage-advance** for forward sequences (Lead Claimed, Connected, …); **reactivation to active** for stalled/deferred re-engagement sequences.*
- **Advanced to next stage:** `count(*) FILTER (WHERE advanced) / count(*)` per variant → conversion rate.
- **Time to advance:** `avg(advanced_at − enrolled_at)` per variant.
- **Quantity advanced:** `count(*) FILTER (WHERE advanced)` per variant.

### Step funnel — where deals get lost (per variant)
Every task carries `step_key` + an observed `outcome` (`lead_replied` / `no_reply`), and each run records `advanced_at_step`. So for a single sequence you get a **per-step funnel**: of all enrolled deals, what % **reached** each step (msg1 → followup_1d → followup_3d → stalled → closed) and what % **advanced at** each step vs. continued to the next. That's the drop-off map — e.g. *"80% reach followup_1d but only 5% advance there"* pinpoints exactly where momentum dies. One query, grouped by `step_key`, per variant. This is what turns A/B from "B is worse" into "B loses everyone at message 4."

Plus guardrails worth tracking: block/report rate, and touches-sent (so "5 in 2h" doesn't win on speed while burning the audience).

> Volume caveat: ~45 deals/month means an A/B test needs months to reach significance. Design it now; read it over quarters.

## Build step 1 — data-model migration (the foundation) — ✅ DONE 2026-06-10

Created via the **metadata API** (createOne object/field mutations), NOT raw SQL — only the metadata API generates the real workspace columns. Additive and reversible (deactivate/delete). Runtime custom objects/fields, consistent with how every other enso object was built.

**Status: applied to production + verified** (script: `sequencing-migration.mjs`, idempotent; backup: `sequencing-migration-backup.json`). Object IDs — sequence `d4c87a9f-7c90-4053-810e-3f034dda9e0d`, sequenceRun `ce77a4e0-8d0b-4549-8385-8b1ce0462222`, dealStateHistory `625a946d-e809-42c9-858d-09b64c0f52ff`, task `01efff38-ce54-4e9e-8dca-3adfab7d6a3d`. All 6 task fields + 30 object fields + 5 relations confirmed in Postgres and in the physical workspace schema (`_sequence`/`_sequenceRun`/`_dealStateHistory` tables, `task.sequenceRunId` FK).
**Gotcha:** right after the metadata-API burst, the flat-map metadata cache lags / is mid-recompute — reads can look incomplete or briefly scrambled. It settles within ~a minute; verify against Postgres for ground truth, don't trust the immediate `objects→fields` bulk read. **Field types:** enums are **SELECT** — `channel` (Social/Call/Form), `outcome` (Lead Replied/No Reply/N/A), `stage` (8, mirrors `opportunity.stage` exactly), `pipelineState` (Active/Stalled/Deferred), `endReason` (Advanced/Stalled/Closed/Superseded); free-form stay **TEXT** — `variant`, `stepKey`/`advancedAtStep` (engine-written, open-growing set), `workflowId`, `reason`. (TEXT→SELECT conversion done via deactivate→delete→recreate while fields were empty: `sequencing-fix-selects.mjs`.)

### Extend native `task` (6 custom fields)
| Field | Type | Notes |
|---|---|---|
| `sequenceRun` | RELATION → `sequenceRun` (MANY_TO_ONE) | null = manual task (same object, no second type) |
| `variant` | TEXT | A/B arm label, denormalized for grouping |
| `stepKey` | SELECT | `social.lead_claimed.msg1` / `.followup_1d` / `.followup_3d` … |
| `channel` | SELECT | social / call / form |
| `isAutoCreated` | BOOLEAN | sequence-born vs manager-created |
| `outcome` | SELECT | `lead_replied` / `no_reply` / `na` (observed for social) |

### New object `sequence` (one row per variant)
`name` (label) · `channel` SELECT · `stage` SELECT · `pipelineState` SELECT · `weight` NUMBER · `isActive` BOOLEAN · `workflowId` TEXT (→ the Twenty workflow canvas) · (rev relation: `runs` → `sequenceRun`)

### New object `sequenceRun` (one row per deal enrollment — the analytics unit)
`name` · `sequence` RELATION → `sequence` · `variant` TEXT · `opportunity` RELATION → `opportunity` · `enrolledAt` DATE_TIME · `endedAt` DATE_TIME · `endReason` SELECT (advanced/stalled/closed/superseded) · `advanced` BOOLEAN · `advancedToStage` SELECT · `advancedAt` DATE_TIME · `advancedAtStep` SELECT · (rev relation: `tasks` → `task`)

### New object `dealStateHistory` (transition log — also kills Attio text-timestamp/counter fields)
`name` · `opportunity` RELATION → `opportunity` · `fromStage` SELECT · `toStage` SELECT · `fromPipelineState` SELECT · `toPipelineState` SELECT · `transitionedAt` DATE_TIME · `transitionedBy` RELATION → `workspaceMember` · `reason` TEXT

Order: create the 3 objects → add `task` fields (incl. the `sequenceRun` relation) → set SELECT options. Verify each column lands in the workspace schema before wiring workflows.

## Build step 2 — workflow engine (PROVEN end-to-end 2026-06-10)

**Variant A seeded:** `sequence` record `ef9230e2-999f-4774-98bf-6c6bb113222f` (Social·LeadClaimed·Active, weight 100).

**v0 first-touch workflow proven:** workflow `686ad4de-3bee-4985-9bfb-8fa29f8b101b` — DATABASE_EVENT `opportunity.updated` → FILTER `stage IS LEAD_CLAIMED` → CREATE_RECORD task (channel/stepKey/isAutoCreated). Fired a synthetic deal → run COMPLETED → task created correctly. **Currently DEACTIVATED** (DRAFT, trigger removed) until v1 wiring is done — it's hardcoded SOCIAL with no dispatcher/linking, so not safe for live auto-claimed leads.

**Proven build recipe (the data-API blocks version mutations, so):**
- `createWorkflow` works via data API. `createWorkflowVersion` is **FORBIDDEN** via data API ("Method not allowed") — version + steps must be written to the workspace DB directly (or via the UI builder service).
- Recipe: `createWorkflow` (API) → INSERT `workflowVersion` (`trigger` + `steps` JSON, `status='ACTIVE'`) + INSERT `workflowAutomatedTrigger` (`type=DATABASE_EVENT`, `settings={eventName,fields}`) via SQL → `UPDATE workflow SET statuses='{ACTIVE}', lastPublishedVersionId=<ver>`. DATABASE_EVENT dispatch reads the automatedTrigger from the DB at fire time, so raw insert fires immediately — no restart.
- Step JSON: `{id,name,type,valid,position,settings:{input,outputSchema,errorHandlingOptions},__typename:'WorkflowAction',nextStepIds:[]}`. FILTER select-equality: `{type:'SELECT',operand:'IS',value:'LEAD_CLAIMED',stepOutputKey:'{{trigger.properties.after.stage}}',stepFilterGroupId,positionInStepFilterGroup}`. CREATE_RECORD: `settings.input={objectName,objectRecord:{field:val | '{{trigger.properties.after.X}}'}}`.

**v1 first-touch PROVEN (3-step, run COMPLETED):** FILTER stage=LEAD_CLAIMED → CREATE_RECORD `sequenceRun` (enroll: sequenceId=variant A, opportunityId, variant) → CREATE_RECORD task (assigned to owner via `{{trigger.properties.after.ownerId}}`, stamped channel/stepKey/isAutoCreated, linked to run via `{{<enrollStepId>.id}}`). Cross-step id refs and trigger refs both resolve at runtime. Workflow `686ad4de…` version `1550c5f1…`, DEACTIVATED (DRAFT) between tests.
**BLOCKED:** workflow `CREATE_RECORD` on join objects fails — `taskTarget` → *"Object cannot be created by workflow."* So the deal's Tasks-tab pin can't be set from the workflow; the task is still assigned-to-owner (shows in My Tasks) and tied to the deal via sequenceRun→opportunity. Deal-Tasks-tab link is a follow-up (CODE step / backend query-hook).
**Remaining:** channel detection (not hardcoded SOCIAL), weighted variant pick for A/B (CODE step — single variant needs none yet), delay + follow-up steps (+1d/+3d), stall+auto-close, reply observer (lead inbound → Connected).

## Build step 3 — the scanner (backend cron job) — ✅ DEPLOYED + VERIFIED LIVE 2026-06-11

Merged via PRs #87 (base) → #89 (IsNull→JS filter) → #90 (register in worker JobsModule) → #91 (endReason uppercase enum value). Verified end-to-end: a back-dated run produced followup_1d+followup_3d tasks (assigned), STALLED the deal, auto-closed CLOSED_LOST/UNREACHABLE, ended the run (endReason=CLOSED). Gotchas hit (now documented in [[sequencing-design]] memory): no CI on this repo (Railway build is the gate); worker jobs must register in `engine/core-modules/message-queue/jobs.module.ts` not modules.module.ts; TwentyORM `where` rejects TypeORM operators (use JS filter); SELECT writes need exact uppercase enum values.

**ENGINE STATE: LIVE (2026-06-11).** The first-touch workflow (686ad4de / published version 1550c5f1) is ACTIVE with automated trigger `3e747e87` (DATABASE_EVENT `opportunity.updated` on `stage`). Synthetic-verified end-to-end: opp ROUTING→LEAD_CLAIMED fired → `sequenceRun` + first-touch `task` auto-created (test records purged). Activation recipe: `createWorkflowAutomatedTrigger` via data API, but version/workflow status set by RAW SQL (`UPDATE "workflowVersion" SET status='ACTIVE'` + `UPDATE workflow SET statuses='{ACTIVE}'`) — the data API forbids version-status writes ("Cannot update workflow version status manually"). **Reply observer (built — folded into the scanner, not a canvas workflow):** the native `message` tables are empty on this instance; all inbound lead activity lives in the ENSO `inboundActivity` object (`kind=SOCIAL_MESSAGE`, source CHATWOOT/META) which carries `opportunityId` directly. The canvas can't traverse message→opportunity, so the scanner does it: for each open Lead-Claimed run it checks for an inbound `SOCIAL_MESSAGE` with `occurredAt > enrolledAt` (the pre-claim first message predates enrollment, so no false positive) → advances the deal `LEAD_CLAIMED → CONNECTED` (stamping `firstContactAt`/`firstContactChannel=SOCIAL` if unset) and ends the run `ADVANCED`. ≤60s latency to auto-advance, which is immaterial. **WATCH:** detection is *any* inbound social message after enrollment (relaxed "any-free-text"); manager-outbound isn't visible in the CRM (managers reply Meta-side), so the manager's claim (→ run start) is the proxy for "manager engaged."

**Channel detection + gating (built — in the scanner):** `firstContactChannel` is null on deals at claim time (intake doesn't set it), so the deal's origin channel is derived from its **earliest linked `inboundActivity.kind`**: `SOCIAL_MESSAGE`→SOCIAL, `INCOMING_CALL`→CALL, `FORM_SUBMISSION`/`LEAD_AD`→FORM; no/unknown origin defaults to SOCIAL. The first-touch workflow can't gate by channel (the trigger payload is just the opportunity, with `firstContactChannel` null), so it enrolls *every* Lead-Claimed deal — and the scanner gates: only `SOCIAL` has a live sequence today, so runs for any other channel are ended `SUPERSEDED` (no cadence) until that channel's sequence is built. Follow-up tasks are now stamped with the resolved channel instead of a hardcoded `SOCIAL`. Side effect: a non-social claimed deal still gets the single workflow-created first-touch task before its run is superseded (benign — "make first contact"); only the +1d/+3d cadence is suppressed. Next per-channel work = build Form/Call sequences + a dispatcher that picks the sequence by channel (then add the channel to `CHANNELS_WITH_LIVE_SEQUENCE`).

**Deal Tasks-tab pin (built — in the scanner):** workflows can't create join objects (`taskTarget` → "Object cannot be created by workflow"), so the scanner backfills them. For each open run it links every run task (first-touch + follow-ups) to the deal via `taskTarget{taskId, targetOpportunityId}` and to the contact via `{taskId, targetPersonId: opportunity.pointOfContactId}` — idempotent (skips links that already exist), and done *before* the reply/gate/cadence branches so even superseded/connected deals get their first-touch task pinned. Result: auto-created sequencing tasks show on the deal record's Tasks tab (and the contact's). `taskTarget` is the polymorphic join with `target<Object>Id` columns (`targetOpportunityId`/`targetPersonId`/…) + `taskId`.

**Weighted A/B + enrollment moved to the scanner (built):** enrollment is no longer done by the first-touch workflow (it couldn't pick a variant by weight or gate channel) — **workflow `686ad4de` is now DEACTIVATED (trigger deleted, DRAFT)** and the scanner owns the full lifecycle. Each scan, an **enrollment pass** finds `LEAD_CLAIMED` deals with no open run, resolves the origin channel (gating non-social up front — no more enroll-then-supersede), and picks a `sequence` row for the slot (channel × Lead Claimed × Active) by **weighted random** over `sequence.weight`. A new `variant` TEXT field on `sequence` (seeded `v1` on `ef9230e2`) tags each variant row; the picked variant + sequenceId are stamped on the run AND every task (first-touch + follow-ups) so analytics group by variant for free. Trade-off accepted: first-touch task now appears ≤60s after claim instead of instantly. To add a 2nd variant: create another `sequence` row (same slot, its own `variant` tag + `weight`) — the scanner splits traffic automatically; no code change.

Two guards on scanner enrollment (since the scanner sweeps *all* Lead-Claimed deals rather than firing on the transition like the old workflow): (1) **forward-only** — only deals with `updatedAt ≥ ENROLLMENT_CUTOFF_ISO` (go-live) enroll, so historical Lead-Claimed deals aren't back-enrolled; (2) **explicit origin** — `resolveDealChannel` returns `undefined` for an undeterminable origin and enrollment requires an explicit live-sequence channel (no default-to-social), so an unknown/form/call-origin deal is never dropped into the social cadence. Gotcha learned here: raw `repository.save()` into a **custom** object needs the actor populated — `_sequenceRun.createdByName`/`updatedByName` are NOT NULL with no DB default (standard objects default to `'System'`), so a bare insert hits pg `23502`; fixed by adding the `'System'` default to those columns (the data API's create-resolver sets the actor, raw saves don't).

### (original blueprint below)
## Build step 3 — the scanner (backend cron job) — BLUEPRINT

Time-based cadence + stall + close = one cron job. Event pieces stay as canvas workflows; this is the time-driven sweep (the canvas can't guard across DELAYs cleanly — frozen trigger snapshot — so a scanner that reads live state is the right shape). **This is a code PR (build → CI → deploy), not a hot change.**

**Files** (under `packages/twenty-server/src/modules/enso/sequencing/`):
- `sequencing.constants.ts` — pattern `'* * * * *'`; `LEAD_CLAIMED`/`STALLED`/`CLOSED_LOST`/`UNREACHABLE`; social LC cadence: followups `social.lead_claimed.followup_1d` @ +1d, `social.lead_claimed.followup_3d` @ +3d; stall after +3d; auto-close after +7d grace.
- `jobs/sequencing-scanner.cron.job.ts` — `@Processor(MessageQueue.cronQueue)` + `@Process(name)` + `@SentryCronMonitor`. Inject core `DataSource`, `@InjectRepository(WorkspaceEntity)`, `GlobalWorkspaceOrmManager`.
- `commands/sequencing-scanner.cron.command.ts` — `@Command({name:'cron:enso:sequencing-scanner'})` → `messageQueueService.addCron({jobName, options:{repeat:{pattern}}})` (mirror `WorkflowCronTriggerCronCommand`).
- `sequencing.module.ts` — provides job + command + service.

**Workspace data access** (per chatwoot-assignment.service):
```ts
const ctx = buildSystemAuthContext(workspaceId); // engine/twenty-orm/utils/build-system-auth-context.util
await globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
  const runs = await globalWorkspaceOrmManager.getRepository<any>(workspaceId,'sequenceRun',{shouldBypassPermissionChecks:true});
  const opps = await globalWorkspaceOrmManager.getRepository<any>(workspaceId,'opportunity',{shouldBypassPermissionChecks:true});
  const tasks = await globalWorkspaceOrmManager.getRepository<any>(workspaceId,'task',{shouldBypassPermissionChecks:true});
  ...
}, ctx);
```

**Algorithm (per active workspace):** find open runs (`endReason IS NULL`). For each: load its opportunity.
- stage no longer `LEAD_CLAIMED` → end run: if advanced (Connected+) set `advanced=true,advancedToStage,advancedAt,endReason='advanced'`; if closed `endReason='closed'`. (Safety net; the reply observer also does advance.)
- still `LEAD_CLAIMED`: `elapsed = now - (enrolledAt ?? createdAt)`.
  - for each cadence followup whose `afterMs ≤ elapsed` and no task with that `stepKey` exists for the run → create task (objectName task: title, channel from sequence, stepKey, isAutoCreated=true, sequenceRunId=run.id, assigneeId=opp.ownerId).
  - elapsed ≥ stall-after and `opp.pipelineState !== 'STALLED'` → set `opp.pipelineState='STALLED'`.
  - elapsed ≥ stall-after + 7d grace → set `opp.stage='CLOSED_LOST'`, `opp.lostReason='UNREACHABLE'`; end run `endReason='closed'`.

**Wiring:** add `EnsoSequencingModule` to `modules.module.ts` (worker loads the Processor) AND to `database-command.module.ts` imports; add the cron command to `CronRegisterAllCommand` (constructor + `allCommands` list). Cron registered by `cron:register:all` at deploy.

**Test post-deploy:** can't fast-forward time — back-date a test `sequenceRun.createdAt` (SQL) or temporarily shrink thresholds, fire a synthetic deal, watch the followup/stall/close land. NB: tasks created here are assigned (My Tasks) + tied via run→opportunity; the deal Tasks-tab pin (taskTarget) still needs a CODE step / query-hook (workflow can't create join objects).

## Decisions (resolved 2026-06-10)
- **Cadence is identical for every lead** regardless of bot engagement — a silent lead gets the same 3 manager touches as an engaged one. Revisit via the step funnel if non-responders prove not worth the touches.
- **v1 social cadence (the A/B control arm):** Day 0 / +1 day / +3 days (3 manager touches) → STALL → 7-day grace → auto-close **Unreachable**.
- **Deal resolution:** attach a new activity to an existing **open** deal for the **same person + same project**; if none is open, **create** a new deal. (Closed deal → new deal. No time window.)
- **"Connected" = order-independent:** a manager has sent ≥1 message **and** the lead has ≥1 free-text reply. ⚠️ **WATCH real cases** — may later relax to *"any lead free-text = Connected"* (drop the manager-message requirement) if the stricter rule is dropping real connections.
- **Conversion event depends on the sequence's purpose:** forward-stage sequences succeed by **advancing the deal stage**; stalled/deferred (re-engagement) sequences succeed by **returning the deal to active** (reactivation). Social Lead Claimed v1 has **no** re-engagement touches in stall — it's just watch → close.

## Still open
- Reply-observer guard vs a `WAIT_FOR_TASK_OUTCOME` node — **start with the guard/3-workflow split** (zero new code); build the node only if the split proves too fragmented to author/read. Parked, revisit.
- Other channels' cadences (form/lead-ad: deeper, contact-requested; call: split by sales-pickup vs missed).
