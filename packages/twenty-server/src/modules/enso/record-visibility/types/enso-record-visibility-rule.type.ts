export type EnsoRecordVisibilityConditionArgs = {
  // Reference a column of the record currently being filtered. Resolves to an
  // aliased reference on selects and a bare one on updates/deletes.
  ref: (columnName: string) => string;
  // Quoted workspace schema, safe to interpolate into subqueries.
  schema: string;
  // Bound parameter placeholder holding the current workspace member id.
  me: string;
  // Deals a member was mentioned on are theirs to read, never to edit, so the
  // mention grant is only added on selects. Also false until the mention object
  // exists in the workspace — the rule would otherwise reference a missing
  // table and break every scoped query.
  includeMentionedDeals: boolean;
};

export type EnsoRecordVisibilityRule = {
  buildCondition: (args: EnsoRecordVisibilityConditionArgs) => string;
};
