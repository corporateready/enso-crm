// Records that only mean something while attached. Detaching a family link
// from a person's Family card would leave a row pointing at nobody, so these
// cards offer Delete only.
export const ENSO_NO_DETACH_RELATION_OBJECT_NAMES: string[] = [
  'personRelationship',
];
