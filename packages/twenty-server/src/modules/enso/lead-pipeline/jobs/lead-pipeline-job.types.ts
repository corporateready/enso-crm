// Job payloads for the lead pipeline. Every job carries workspaceId — jobs run
// in the worker with a system auth context built from it.

export type ResolveOpportunityFromActivityJobData = {
  workspaceId: string;
  activityId: string;
};

export type RouteOpportunityJobData = {
  workspaceId: string;
  opportunityId: string;
  // Managers already tried in prior attempts (excluded from round-robin).
  excludedManagerIds: string[];
  // 0-based routing attempt; mirrored onto opportunity.routingCount.
  attempt: number;
};

export type NotifyManagerAssignmentJobData = {
  workspaceId: string;
  opportunityId: string;
  managerId: string;
  // true = sticky owner auto-claimed (returning client); no claim countdown.
  autoClaimed: boolean;
};

// Phase 2 manager notifications. Server-side listeners detect the change and
// enqueue one of these; the worker posts via ManagerNotificationService (which
// applies the per-event toggle + resolves the manager's personal webhook).
export type ManagerNotifyJobData =
  | {
      workspaceId: string;
      kind: 'lost_reassigned';
      opportunityId: string;
      managerId: string;
    }
  | {
      workspaceId: string;
      kind: 'deal_state_changed';
      opportunityId: string;
      managerId: string;
      transition: 'stalled' | 'deferred' | 'active' | 'stage';
      newStage?: string;
    }
  | {
      workspaceId: string;
      kind: 'task_assigned';
      taskId: string;
      managerId: string;
    }
  | {
      workspaceId: string;
      kind: 'task_due';
      taskId: string;
      managerId: string;
    }
  | {
      workspaceId: string;
      kind: 'consent_changed';
      personId: string;
      projectId: string;
      managerId: string;
    };

export type ClaimCheckJobData = {
  workspaceId: string;
  opportunityId: string;
  // The attempt this claim window belongs to (for idempotent job ids + reroute).
  attempt: number;
  excludedManagerIds: string[];
};
