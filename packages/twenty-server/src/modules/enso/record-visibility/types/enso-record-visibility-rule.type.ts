export type EnsoRecordVisibilityConditionArgs = {
  // Reference a column of the record currently being filtered. Resolves to an
  // aliased reference on selects and a bare one on updates/deletes.
  ref: (columnName: string) => string;
  // Quoted workspace schema, safe to interpolate into subqueries.
  schema: string;
  // Bound parameter placeholder holding the current workspace member id.
  me: string;
};

export type EnsoRecordVisibilityRule = {
  buildCondition: (args: EnsoRecordVisibilityConditionArgs) => string;
};
