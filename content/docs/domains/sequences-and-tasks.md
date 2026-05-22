---
title: Sequences and Tasks
description: The engine. Template-driven sequences + ad-hoc tasks coexist. Cadences trigger Novu workflows for prospect emails.
---

# Sequences and Tasks

The user-named "whole separate module" — the engine that dictates the next step for managers, with effectiveness analytics built in. Implemented as a NestJS module in our Twenty fork: `sequences`.

Two complementary modes coexist:

1. **System-generated tasks from sequence templates** — state-machine-driven chain governing stage advancement
2. **Manager-created ad-hoc tasks** — agent says "call Friday at 3pm" or "send floor plan", system schedules and nudges

Both surface in **My Tasks**. Same table, different `kind`.

## Schema

### Templates (state machine definition, in code config)

```text
sequence_templates  (TypeScript config file in repo, seeded at deploy)
├── id (text, deterministic) — e.g. "call.lead_claimed.first"
├── name (text) — human label, multilingual
├── description (text) — multilingual
├── channel (enum: call, social, form, any)
├── stage (enum: matches deal.stage)
├── iteration (int) — 1, 2, 3 in a chain
├── status_type (enum: active, waiting)
├── default_due_offset_minutes (int) — e.g. 5 for first touch
├── required_fields_to_complete (text[])
├── advances_stage_to (enum, nullable)
├── follow_up_template_id (text, nullable)
├── close_deal_on_outcome (text[])
├── triggers_novu_workflow (text, nullable) — workflow name to fire for prospect notification
├── triggers_knock_workflow (text, nullable) — workflow name to fire for manager notification
└── active (boolean)
```

Templates live as TypeScript config in `apps/server/src/modules/sequences/templates/*.ts`, version-controlled, deployed with the app. Phase 2+ may add a UI editor; v1 is engineer-only per [open-questions](../open-questions) #12.

### Task instances (the things managers see)

```text
tasks (Twenty workspace table)
├── id (uuid)
├── deal_id (fk)
├── kind (enum: sequence_step, ad_hoc, validation_gate)
├── template_id (text, nullable — null for ad_hoc/validation_gate)
├── title (text) — copy of template.name at instantiation
├── description (text) — copy of template.description
├── assigned_to_user_id (fk → users)
├── created_by_user_id (fk → users, nullable — null for system)
├── due_at (timestamptz)
├── started_at (timestamptz, nullable)
├── completed_at (timestamptz, nullable)
├── disposition_id (fk → dispositions, nullable until completed)
├── outcome_id (fk → outcomes, nullable until completed)
├── outcome_notes (text)
├── linked_interaction_id (fk → interactions, nullable) — what the manager actually did
├── snoozed_until (timestamptz, nullable)
├── archived (boolean default false)
└── created_at, updated_at
```

### Dispositions + Outcomes (managed enums in Twenty)

```text
dispositions: done, skipped, canceled
outcomes: connected, no_answer, voicemail, busy, wrong_number,
          callback_requested, not_interested, qualified, disqualified
```

Per [open-questions](../open-questions) #4 — confirm with sales.

## The three task kinds

### 1. `sequence_step` — from a template

Created automatically by the state machine when:
- Deal enters a stage with a `First Sequence` template for that source/channel
- A `sequence_step` completes with Outcome=callback_requested → spawns follow-up
- A `validation_gate` completes → spawns next stage's first step

### 2. `ad_hoc` — manager-created

Manager opens a Deal, clicks "New Task", picks a kind:
- "Call back at <datetime>"
- "Send floor plan via email"
- "Schedule demo"
- "Internal note"

Don't gate stage advancement. Get same overdue treatment.

### 3. `validation_gate` — created when stage advance blocked

When a stage transition's required fields are missing, system creates a `validation_gate` task: *"Fill First Contact Time + Channel to advance to Connected."* Marked as priority. Filling the fields auto-completes the gate + advances the stage.

## State machine driving sequence creation

Live in `sequences/sequence-creator.service.ts`:

```ts
@OnEvent('deal.stage_changed')
async onStageChanged({ deal, fromStage, toStage }: StageChangedEvent) {
  // 1. Find first template matching (toStage, channel = derived from source)
  const template = await templates.find({ stage: toStage, iteration: 1, channel: deriveChannel(deal) })
  if (!template) return

  // 2. Create task instance
  await tasks.create({
    deal_id: deal.id,
    kind: 'sequence_step',
    template_id: template.id,
    title: template.name,
    assigned_to_user_id: deal.owner_user_id,
    due_at: now() + minutes(template.default_due_offset_minutes),
  })

  // 3. Fire prospect notification (if defined on template)
  if (template.triggers_novu_workflow) {
    await novu.trigger(template.triggers_novu_workflow, {
      to: { subscriberId: deal.person_id },
      payload: { deal, project: deal.project }
    })
  }

  // 4. Fire manager notification (always)
  await knock.trigger('new-task-assigned', {
    recipients: [deal.owner_user_id],
    data: { task, deal }
  })
}
```

## Disposition × Outcome decision engine

On `task.completed` event:

```ts
@OnEvent('task.completed')
async onTaskCompleted({ task, disposition, outcome }) {
  const template = await templates.findById(task.template_id)
  if (!template) return  // ad_hoc task, no follow-up

  // Closed-on-outcome (e.g. "not_interested" → Closed Lost)
  if (template.close_deal_on_outcome.includes(outcome.code)) {
    return stateMachine.transition(task.deal_id, 'ClosedLost', { reason: outcome.code })
  }

  // Connected outcome → try advancing stage
  if (outcome.code === 'connected' && template.advances_stage_to) {
    return stateMachine.transition(task.deal_id, template.advances_stage_to)
  }

  // Callback / no_answer → schedule follow-up
  if (template.follow_up_template_id) {
    const followUp = await templates.findById(template.follow_up_template_id)
    await tasks.create({
      deal_id: task.deal_id,
      kind: 'sequence_step',
      template_id: followUp.id,
      assigned_to_user_id: task.assigned_to_user_id,
      due_at: now() + minutes(followUp.default_due_offset_minutes),
    })
  }
}
```

Clean enough to read in one pass. Tested with a table of `(template, disposition, outcome) → expected effects` rows.

## Initial template catalog

Lifted from the n8n analysis, parameterized. **Novu prospect-notification triggers deferred from v1** (per user direction — lifecycle cadences added post-launch). Phase-1 templates focus on the manager-side task chain; Novu workflow column shows the eventual hook, marked `[v2]` for what's not in scope yet.

| Code | Channel | Stage | Iteration | SLA offset | Advances on connected | Novu trigger |
|---|---|---|---|---|---|---|
| `call.lead_claimed.first` | call | LeadClaimed | 1 | +5 min | Connected | — |
| `social.lead_claimed.first` | social | LeadClaimed | 1 | +5 min | Connected | — |
| `form.lead_claimed.first` | form | LeadClaimed | 1 | +5 min | Connected | `welcome-form-submit` (transactional) |
| `*.lead_claimed.followup_1d` | any | LeadClaimed | 2 | +1 day | Connected | `[v2] re-engagement-day-1` |
| `*.lead_claimed.followup_3d` | any | LeadClaimed | 3 | +3 days | Connected | `[v2] re-engagement-day-3` |
| `*.lead_claimed.followup_7d` | any | LeadClaimed | 4 | +7 days | Connected | `[v2] re-engagement-day-7` |
| `*.connected.first` | any | Connected | 1 | +30 min | DeepQualification | — |
| `*.connected.followup_1d` | any | Connected | 2 | +1 day | DeepQualification | — |
| `validation.lead_claimed_to_connected` | — | LeadClaimed | — | until done | Connected (when fields filled) | — |
| `validation.connected_to_deep_qual` | — | Connected | — | until done | DeepQualification | — |
| `*.deep_qual.first` | any | DeepQualification | 1 | +1 day | Demo | — |
| `*.demo.scheduled` | any | Demo | 1 | until `demo_scheduled_at` | (manual post-demo) | `demo-reminder` (24h before, SMS) |
| `*.demo.followup` | any | Demo | 2 | +30 min after demo | (manual) | — |
| `*.contracting.followup_1d` | any | Contracting | 1 | +1 day | (manual close) | — |
| `*.contracting.followup_3d` | any | Contracting | 2 | +3 days | — | — |

SLA values are educated defaults from the n8n flows. Tunable per template at the config layer.

## Effectiveness analytics

Real query examples, runnable against `tasks`:

```sql
-- Conversion rate per template
SELECT
  template_id,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE outcome.code = 'connected') AS connected_count,
  AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 60) FILTER (WHERE completed_at IS NOT NULL) AS avg_minutes_to_complete
FROM tasks
JOIN outcomes ON outcomes.id = tasks.outcome_id
WHERE template_id IS NOT NULL
GROUP BY template_id;
```

```sql
-- SLA hit rate (completed before due_at)
SELECT
  template_id,
  COUNT(*) FILTER (WHERE completed_at IS NOT NULL AND completed_at <= due_at) * 1.0 / COUNT(*) AS sla_hit_rate
FROM tasks
WHERE template_id IS NOT NULL AND completed_at IS NOT NULL
GROUP BY template_id;
```

These materialize into Lightdash dashboards via BigQuery.

## My Tasks view (manager UI)

Single mixed list of `sequence_step` + `ad_hoc` + `validation_gate`, sorted by:

1. **Overdue** (red — system-tasks AND ad-hoc both)
2. **Validation gates** (orange — blocking stage advance)
3. **Due today**
4. **Due this week**
5. **Snoozed** (gray)

Each card: deal name, project, due_at, kind icon, description preview, [Complete] [Snooze] actions. Built as a custom Twenty UI screen in our fork.

## Why this solves the user's named pain

> "managers make own tasks freely — actually those 2 created nicely are one of main pains of attio or any crm to configure"

Solution:

| System-generated | Ad-hoc |
|---|---|
| Created by state machine on stage events | Created by manager on demand |
| SLA timer fixed by template | Manager sets due_at |
| Gates stage advancement | Doesn't gate anything |
| Templates engineer-authored, versioned in repo | Free-form text from manager |
| Knock + Novu workflows fire | Knock only (manager notification) |
| Outcome captured = decision input to state machine | Outcome captured = closeout |

Both visible in one screen. Both get same overdue treatment. Both feed effectiveness analytics. Neither tries to be the other.

## What today's Sequences object becomes

| Today (Attio Sequences + n8n) | Rebuild (Twenty `sequences` module) |
|---|---|
| 1 Sequences object record per task = ~tens of thousands of records | `tasks` table; templates separate |
| `sequence_name` is the state | `template.id` is the state |
| `sequence_status` enum (Today Tasks / Waiting / Done / Future Tasks) | Derived from `due_at` vs `now()` + `completed_at` |
| `disposition` + `purpouse` (typo) selects | `disposition_id` + `outcome_id` FKs to managed enums |
| `sequence_due_datetime` text | `due_at` timestamptz |
| `warning_sent` free text | `task_warnings(task_id, channel)` UNIQUE |
| 6 separate n8n workflows (~770 nodes) | State machine + cron worker + UI, all in code |
| n8n triggers Sequence creation | NestJS @OnEvent listeners |
| Comments on Sequence records as warnings | Knock notifications |
