// The person's "Family" field: the family links where this person is the
// subject. The full picture lives on the Family tab, so the field itself only
// summarises.
export const isEnsoFamilyField = (
  objectNameSingular: string | undefined,
  fieldName: string,
) => objectNameSingular === 'person' && fieldName === 'relationships';
