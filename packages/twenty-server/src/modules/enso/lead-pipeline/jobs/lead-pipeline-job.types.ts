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
};

export type ClaimCheckJobData = {
  workspaceId: string;
  opportunityId: string;
  // The attempt this claim window belongs to (for idempotent job ids + reroute).
  attempt: number;
  excludedManagerIds: string[];
};
