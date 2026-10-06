import { useLingui } from '@lingui/react/macro';
import { styled } from '@linaria/react';
import { useState } from 'react';
import { isDefined } from 'twenty-shared/utils';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { useCreateOneRecord } from '@/object-record/hooks/useCreateOneRecord';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';

// Adds a relative to the person in focus in one step: pick someone already
// in the CRM or type a new name, choose the relation, Add. Nothing is saved
// until the link is complete, so an abandoned attempt leaves no half-filled
// record behind.

const RELATION_TYPES = [
  'SPOUSE',
  'PARTNER',
  'PARENT',
  'CHILD',
  'SIBLING',
  'OTHER',
] as const;

type RelationType = (typeof RELATION_TYPES)[number];

type PersonOption = {
  id: string;
  name?: { firstName?: string; lastName?: string };
};

const StyledForm = styled.div`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[3]};
`;

const StyledRow = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledLabel = styled.span`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledInput = styled.input`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  flex: 1;
  font-size: ${themeCssVariables.font.size.sm};
  min-width: 200px;
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
`;

const StyledSelect = styled.select`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.sm};
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
`;

const StyledOptions = styled.div`
  display: flex;
  flex-direction: column;
`;

const StyledOption = styled.button<{ $isSelected: boolean }>`
  background: ${({ $isSelected }) =>
    $isSelected
      ? themeCssVariables.background.tertiary
      : themeCssVariables.background.transparent.lighter};
  border: none;
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  cursor: pointer;
  font-size: ${themeCssVariables.font.size.sm};
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
  text-align: left;

  &:hover {
    background: ${themeCssVariables.background.tertiary};
  }
`;

const StyledButton = styled.button<{ $isPrimary?: boolean }>`
  background: ${({ $isPrimary }) =>
    $isPrimary
      ? themeCssVariables.color.blue
      : themeCssVariables.background.primary};
  border: 1px solid
    ${({ $isPrimary }) =>
      $isPrimary
        ? themeCssVariables.color.blue
        : themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${({ $isPrimary }) =>
    $isPrimary
      ? themeCssVariables.font.color.inverted
      : themeCssVariables.font.color.secondary};
  cursor: pointer;
  font-size: ${themeCssVariables.font.size.sm};
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[3]};

  &:disabled {
    cursor: default;
    opacity: 0.5;
  }
`;

const StyledError = styled.div`
  color: ${themeCssVariables.color.red};
  font-size: ${themeCssVariables.font.size.sm};
`;

const fullName = (person: PersonOption) =>
  `${person.name?.firstName ?? ''} ${person.name?.lastName ?? ''}`.trim();

// "Maria Elena Popescu" → first "Maria Elena", last "Popescu".
const splitName = (typed: string) => {
  const parts = typed.trim().split(/\s+/);

  return parts.length > 1
    ? { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) ?? '' }
    : { firstName: parts[0] ?? '', lastName: '' };
};

type AddRelativeFormProps = {
  focusId: string;
  focusName: string;
  onAdded: () => void;
  onCancel: () => void;
};

export const AddRelativeForm = ({
  focusId,
  focusName,
  onAdded,
  onCancel,
}: AddRelativeFormProps) => {
  const { t } = useLingui();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<PersonOption | 'new'>();
  const [relationType, setRelationType] = useState<RelationType>('SPOUSE');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const term = query.trim();
  const { records: matches = [] } = useFindManyRecords<
    PersonOption & { __typename: string }
  >({
    objectNameSingular: 'person',
    filter: {
      and: [
        { id: { neq: focusId } },
        {
          or: [
            { name: { firstName: { ilike: `%${term}%` } } },
            { name: { lastName: { ilike: `%${term}%` } } },
          ],
        },
      ],
    },
    recordGqlFields: { id: true, name: true },
    skip: term.length < 2,
    limit: 6,
  });

  const { createOneRecord: createPerson } = useCreateOneRecord({
    objectNameSingular: 'person',
  });
  const { createOneRecord: createLink } = useCreateOneRecord({
    objectNameSingular: 'personRelationship',
  });

  const relationLabels: Record<RelationType, string> = {
    SPOUSE: t`Spouse`,
    PARTNER: t`Partner`,
    PARENT: t`Parent`,
    CHILD: t`Child`,
    SIBLING: t`Sibling`,
    OTHER: t`Other relative`,
  };

  const canAdd =
    !saving && (selected === 'new' ? term.length >= 2 : isDefined(selected));

  const add = async () => {
    setSaving(true);
    setError(undefined);

    try {
      let relatedPersonId: string | undefined;

      if (selected === 'new') {
        const created = await createPerson({ name: splitName(term) });

        relatedPersonId = created?.id;
      } else {
        relatedPersonId = selected?.id;
      }

      if (!isDefined(relatedPersonId)) {
        throw new Error(t`Could not save this person.`);
      }

      await createLink({ personId: focusId, relatedPersonId, relationType });
      onAdded();
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message.length > 0
          ? caught.message
          : t`Could not add this relative.`,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <StyledForm>
      <StyledRow>
        <StyledInput
          autoFocus
          placeholder={t`Search people or type a new name`}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(undefined);
          }}
        />
      </StyledRow>
      {term.length >= 2 && (
        <StyledOptions>
          {matches.map((person) => (
            <StyledOption
              key={person.id}
              type="button"
              $isSelected={selected !== 'new' && selected?.id === person.id}
              onClick={() => setSelected(person)}
            >
              {fullName(person) || t`Unnamed person`}
            </StyledOption>
          ))}
          <StyledOption
            type="button"
            $isSelected={selected === 'new'}
            onClick={() => setSelected('new')}
          >
            {t`+ New person "${term}"`}
          </StyledOption>
        </StyledOptions>
      )}
      <StyledRow>
        <StyledLabel>{t`is ${focusName}'s`}</StyledLabel>
        <StyledSelect
          value={relationType}
          onChange={(event) =>
            setRelationType(event.target.value as RelationType)
          }
        >
          {RELATION_TYPES.map((type) => (
            <option key={type} value={type}>
              {relationLabels[type]}
            </option>
          ))}
        </StyledSelect>
        <StyledButton type="button" $isPrimary disabled={!canAdd} onClick={add}>
          {saving ? t`Adding…` : t`Add`}
        </StyledButton>
        <StyledButton type="button" onClick={onCancel}>
          {t`Cancel`}
        </StyledButton>
      </StyledRow>
      {isDefined(error) && <StyledError>{error}</StyledError>}
    </StyledForm>
  );
};
