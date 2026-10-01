import { useLingui } from '@lingui/react/macro';
import { styled } from '@linaria/react';
import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import {
  buildFamilyTree,
  type FamilyLink,
  type FamilyMember,
  getFirstGenerationIds,
} from '@/enso/family-tree/utils/buildFamilyTree';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useOpenRecordInSidePanel } from '@/side-panel/hooks/useOpenRecordInSidePanel';
import { useLayoutRenderingContext } from '@/ui/layout/contexts/LayoutRenderingContext';

// ENSO — "<Last name> Family" tab on a Person: three generations drawn from the
// person's family links (grandparents down to grandchildren). Read-only; links
// are added and removed on the Family card. A scoped manager sees only the
// links their visibility rules allow.
export const ENSO_PERSON_FAMILY_TREE_MARKER = '__enso_person_family_tree';

const LINK_GQL_FIELDS = {
  id: true,
  name: true,
  personId: true,
  relatedPersonId: true,
  relationType: true,
  relatedPerson: { id: true, name: true },
};

const StyledContainer = styled.div`
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  padding: ${themeCssVariables.spacing[3]};
  width: 100%;
`;

const StyledTitle = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.lg};
  font-weight: ${themeCssVariables.font.weight.semiBold};
`;

const StyledHint = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledGeneration = styled.div`
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
`;

const StyledGenerationLabel = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
  text-transform: uppercase;
`;

const StyledRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: center;
`;

const StyledConnector = styled.div`
  align-self: center;
  background: ${themeCssVariables.border.color.medium};
  height: ${themeCssVariables.spacing[3]};
  width: 1px;
`;

const StyledMember = styled.button<{ $isSelf?: boolean }>`
  background: ${({ $isSelf }) =>
    $isSelf
      ? themeCssVariables.background.tertiary
      : themeCssVariables.background.secondary};
  border: 1px solid
    ${({ $isSelf }) =>
      $isSelf
        ? themeCssVariables.border.color.strong
        : themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.md};
  color: ${themeCssVariables.font.color.primary};
  cursor: ${({ $isSelf }) => ($isSelf ? 'default' : 'pointer')};
  display: flex;
  flex-direction: column;
  font-size: ${themeCssVariables.font.size.sm};
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[3]};
`;

const StyledRelation = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
`;

type Generation = {
  key: string;
  label: string;
  members: (FamilyMember & { relation: string; isSelf?: boolean })[];
};

export const PersonFamilyTree = () => {
  const { t } = useLingui();
  const { targetRecordIdentifier } = useLayoutRenderingContext();
  const personId = targetRecordIdentifier?.id;
  const isPerson =
    targetRecordIdentifier?.targetObjectNameSingular === 'person';
  const skip = !isPerson || !isDefined(personId);

  const { records: people = [] } = useFindManyRecords({
    objectNameSingular: 'person',
    filter: { id: { eq: personId } },
    recordGqlFields: { id: true, name: true },
    skip,
  });

  const { records: ownLinks = [], loading: ownLinksLoading } =
    useFindManyRecords<FamilyLink & { __typename: string }>({
      objectNameSingular: 'personRelationship',
      filter: { personId: { eq: personId } },
      recordGqlFields: LINK_GQL_FIELDS,
      skip,
      limit: 200,
    });

  const firstGenerationIds = isDefined(personId)
    ? getFirstGenerationIds(personId, ownLinks)
    : [];

  const { records: nextLinks = [], loading: nextLinksLoading } =
    useFindManyRecords<FamilyLink & { __typename: string }>({
      objectNameSingular: 'personRelationship',
      filter: { personId: { in: firstGenerationIds } },
      recordGqlFields: LINK_GQL_FIELDS,
      skip: skip || firstGenerationIds.length === 0,
      limit: 500,
    });

  const { openRecordInSidePanel } = useOpenRecordInSidePanel();

  if (skip) {
    return null;
  }

  const person = people[0] as
    | { name?: { firstName?: string; lastName?: string } }
    | undefined;
  const lastName = person?.name?.lastName ?? '';
  const fullName =
    `${person?.name?.firstName ?? ''} ${lastName}`.trim() || t`This person`;
  const title = isNonEmptyString(lastName.trim())
    ? t`${lastName} Family`
    : t`Family`;

  if (ownLinksLoading || nextLinksLoading) {
    return (
      <StyledContainer>
        <StyledTitle>{title}</StyledTitle>
        <StyledHint>{t`Loading…`}</StyledHint>
      </StyledContainer>
    );
  }

  const tree = buildFamilyTree(personId, [...ownLinks, ...nextLinks]);

  const tag = (
    members: FamilyMember[],
    relation: string,
    describeVia?: (names: string) => string,
  ) =>
    members.map((member) => ({
      ...member,
      relation:
        isDefined(describeVia) && isDefined(member.via)
          ? describeVia(member.via.join(' & '))
          : relation,
    }));

  const generations: Generation[] = [
    {
      key: 'grandparents',
      label: t`Grandparents`,
      members: tag(
        tree.grandparents,
        t`Grandparent`,
        (names) => t`${names}'s parent`,
      ),
    },
    {
      key: 'parents',
      label: t`Parents`,
      members: tag(tree.parents, t`Parent`),
    },
    {
      key: 'self',
      label: fullName,
      members: [
        ...tag(
          tree.siblings,
          t`Sibling`,
          (names) => t`Half-sibling · via ${names}`,
        ),
        { id: personId, displayName: fullName, relation: '', isSelf: true },
        ...tag(tree.partners, t`Spouse / partner`),
      ],
    },
    {
      key: 'children',
      label: t`Children`,
      members: tag(tree.children, t`Child`),
    },
    {
      key: 'grandchildren',
      label: t`Grandchildren`,
      members: tag(tree.grandchildren, t`Grandchild`),
    },
  ].filter((generation) => generation.members.length > 0);

  const hasRelatives = Object.values(tree).some(
    (members) => members.length > 0,
  );

  return (
    <StyledContainer>
      <StyledTitle>{title}</StyledTitle>
      {!hasRelatives && (
        <StyledHint>
          {t`No family links yet. Add relatives on the Family card.`}
        </StyledHint>
      )}
      {generations.map((generation, index) => (
        <StyledGeneration key={generation.key}>
          {index > 0 && <StyledConnector />}
          <StyledGenerationLabel>{generation.label}</StyledGenerationLabel>
          <StyledRow>
            {generation.members.map((member) => (
              <StyledMember
                key={member.id}
                type="button"
                $isSelf={member.isSelf}
                disabled={member.isSelf}
                onClick={() =>
                  openRecordInSidePanel({
                    recordId: member.id,
                    objectNameSingular: 'person',
                  })
                }
              >
                {member.displayName || t`Unknown`}
                {isNonEmptyString(member.relation) && (
                  <StyledRelation>{member.relation}</StyledRelation>
                )}
              </StyledMember>
            ))}
          </StyledRow>
        </StyledGeneration>
      ))}
      {tree.others.length > 0 && (
        <StyledGeneration>
          <StyledGenerationLabel>{t`Other relatives`}</StyledGenerationLabel>
          <StyledRow>
            {tree.others.map((member) => (
              <StyledMember
                key={member.id}
                type="button"
                onClick={() =>
                  openRecordInSidePanel({
                    recordId: member.id,
                    objectNameSingular: 'person',
                  })
                }
              >
                {member.displayName || t`Unknown`}
              </StyledMember>
            ))}
          </StyledRow>
        </StyledGeneration>
      )}
    </StyledContainer>
  );
};
