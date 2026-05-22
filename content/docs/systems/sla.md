---
title: SLA and overdue scanning
description: Task scheduling, overdue detection, idempotent warnings. Replaces Sequence Waitings (261 nodes).
---

# SLA and overdue

The current `Sequence | Waitings` flow is **261 nodes across 3 crons** of mostly conditional fan-out to send warnings. The rebuild is one cron job + a notification fan-out, idempotent at the DB level.

## The scanner

Runs every 60 seconds (configurable). One pass per channel.

```sql
WITH overdue_unwarned AS (
  SELECT t.id, t.assigned_to_user_id, t.deal_id, t.due_at, t.title, t.kind
  FROM tasks t
  WHERE t.due_at < now()
    AND t.completed_at IS NULL
    AND t.archived = false
    AND t.snoozed_until IS NULL OR t.snoozed_until < now()
    AND NOT EXISTS (
      SELECT 1 FROM task_warnings tw
      WHERE tw.task_id = t.id AND tw.channel = $1
    )
  LIMIT 500
)
INSERT INTO task_warnings (task_id, channel, warned_at)
SELECT id, $1, now() FROM overdue_unwarned
RETURNING task_id;
```

`task_warnings` has `UNIQUE(task_id, channel)` so re-running is safe. The `RETURNING task_id` list goes to the notification fan-out:

- Channel `in_app` — server-sent event to manager's open browser
- Channel `google_chat` — direct message via Google Chat webhook
- Channel `email` — Resend / Customer.io transactional

## Multiple overdue tiers

A task can be warned multiple times as it gets more overdue. Implemented by including a tier in the channel key:

```text
task_warnings.channel ∈ {
  in_app_first,        -- at due
  in_app_15min,        -- 15 min past due
  google_chat_first,   -- at due
  google_chat_30min,   -- 30 min past
  google_chat_2h,      -- 2 hours past
  email_4h,            -- 4 hours past
  manager_escalation,  -- 24h past → escalate to ops
}
```

Each tier has its own scanner query: `WHERE due_at < now() - INTERVAL '{tier_offset}'`. Same `UNIQUE` semantics give us idempotency per-tier.

## Sequence step SLAs (default)

Defaults per template, overridable per-deal:

| Template kind | Default SLA |
|---|---|
| First touch after Lead Claimed | +5 min |
| First touch after Connected | +30 min |
| Follow-up #2 (Waiting) | +1 day |
| Follow-up #3 (Waiting) | +3 days |
| Follow-up #4 (Waiting) | +7 days |
| Demo prep | +1 day before demo_scheduled_at |
| Demo follow-up | +30 min after demo_scheduled_at |
| Contracting nudge | +1 day, +3 days |

Values come from `sequence_templates.default_due_offset_minutes`. The cron job applies overdue-tier logic uniformly across all task kinds.

## Snooze

Manager can push back a task: "snooze 1 hour", "snooze tomorrow 9am", "snooze 3 days". Sets `tasks.snoozed_until`. Until that time, the task is excluded from overdue scans (but stays visible in My Tasks with snooze indicator).

Snooze is logged as an event so the analytics layer can compute "how often does this template get snoozed?" — useful for SLA tuning.

## Working-hours awareness (optional, phase 2)

A 5-minute SLA at 11:55 PM Saturday probably shouldn't page someone. Phase 2 option: respect `users.working_hours_jsonb`. The scanner skips warnings outside of those hours, queuing them for next-window-start.

Today doesn't have this — `Sequence Waitings` blindly fires regardless of time. Adding it is a small win for manager UX.

## What about pipeline state?

`deferred` deals have tasks far in the future (>2 weeks). Those don't appear in the scanner until they come due. When they do, the task fires normally, and the pipeline state transitions back to `active` (per state machine).

`stalled` deals: typically no future task scheduled. Stalled detection is its own job:

```sql
UPDATE deals SET pipeline_state = 'stalled'
WHERE pipeline_state = 'active'
  AND stage NOT IN ('ClosedWon', 'ClosedLost')
  AND NOT EXISTS (
    SELECT 1 FROM tasks WHERE deal_id = deals.id AND completed_at IS NULL AND archived = false
  )
  AND COALESCE(
    (SELECT MAX(occurred_at) FROM activities WHERE deal_id = deals.id),
    (SELECT MAX(occurred_at) FROM interactions WHERE deal_id = deals.id),
    deals.created_at
  ) < now() - INTERVAL '14 days'
```

Runs daily. Logs each transition in `deal_state_history`.

## What today does that we drop

| Today | Why removed |
|---|---|
| 3 separate cron triggers in `Sequence Waitings` (261 nodes) | One cron, parameterized over tiers |
| `warning_sent` text field as a flag | `UNIQUE(task_id, channel)` constraint |
| Per-channel fan-out as separate workflow branches | Single notification service consuming the scanner's RETURNING list |
| Posting Comments to Attio Sequence record as the warning | Direct push to in-app + Google Chat; comment trail goes to deal, not sequence |
