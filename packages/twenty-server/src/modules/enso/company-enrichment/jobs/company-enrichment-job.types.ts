// Job payloads for company auto-creation + enrichment. Every job carries
// workspaceId — jobs run in the worker with a system auth context built from it.

export type ResolveCompanyFromPersonJobData = {
  workspaceId: string;
  personId: string;
};

export type EnrichCompanyJobData = {
  workspaceId: string;
  companyId: string;
};
