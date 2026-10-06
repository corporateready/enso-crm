import { useLingui } from '@lingui/react/macro';
import { styled } from '@linaria/react';
import { isNonEmptyString } from '@sniptt/guards';
import { useState } from 'react';
import { isDefined } from 'twenty-shared/utils';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import {
  buildFamilyGraph,
  type FamilyLink,
  type FamilyRelation,
} from '@/enso/family-tree/utils/buildFamilyGraph';
import {
  FAMILY_NODE_HEIGHT,
  FAMILY_NODE_WIDTH,
  layoutFamilyGraph,
} from '@/enso/family-tree/utils/layoutFamilyGraph';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useOpenRecordInSidePanel } from '@/side-panel/hooks/useOpenRecordInSidePanel';
import { useLayoutRenderingContext } from '@/ui/layout/contexts/LayoutRenderingContext';

// ENSO — "<Last name> Family" tab on a Person: a connected family tree drawn
// from the family links. Couples are joined by a line and each set of parents
// connects to their own children. Clicking a relative re-centres the tree on
// them in place. Read-only; links are added and removed on the Family field.
// A scoped manager sees only the links their visibility rules allow.
export const ENSO_PERSON_FAMILY_TREE_MARKER = '__enso_person_family_tree';

const LINK_GQL_FIELDS = {
  id: true,
  name: true,
  personId: true,
  relatedPersonId: true,
  relationType: true,
  relatedPerson: { id: true, name: true },
};

type PersonName = { firstName?: string; lastName?: string };

const StyledContainer = styled.div`
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  padding: ${themeCssVariables.spacing[3]};
  width: 100%;
`;

const StyledHeader = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
`;

const StyledTitle = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.lg};
  font-weight: ${themeCssVariables.font.weight.semiBold};
`;

const StyledActions = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledAction = styled.button`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.secondary};
  cursor: pointer;
  font-size: ${themeCssVariables.font.size.sm};
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
`;

const StyledHint = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledScroller = styled.div`
  overflow: auto;
  width: 100%;
`;

const StyledCanvas = styled.div`
  margin: 0 auto;
  position: relative;
`;

const StyledLines = styled.svg`
  left: 0;
  pointer-events: none;
  position: absolute;
  stroke: ${themeCssVariables.border.color.strong};
  top: 0;
`;

const StyledMember = styled.button<{ $isFocus: boolean }>`
  align-items: center;
  background: ${({ $isFocus }) =>
    $isFocus
      ? themeCssVariables.background.tertiary
      : themeCssVariables.background.primary};
  border: 1px solid
    ${({ $isFocus }) =>
      $isFocus
        ? themeCssVariables.border.color.strong
        : themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  box-sizing: border-box;
  color: ${themeCssVariables.font.color.primary};
  cursor: ${({ $isFocus }) => ($isFocus ? 'default' : 'pointer')};
  display: flex;
  flex-direction: column;
  font-size: ${themeCssVariables.font.size.sm};
  justify-content: center;
  padding: 0 ${themeCssVariables.spacing[2]};
  position: absolute;
`;

const StyledName = styled.span`
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledRelation = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
`;

export const PersonFamilyTree = () => {
  const { t } = useLingui();
  const { targetRecordIdentifier } = useLayoutRenderingContext();
  const recordId = targetRecordIdentifier?.id;
  const isPerson =
    targetRecordIdentifier?.targetObjectNameSingular === 'person';

  // Which relative the tree is centred on; tied to the record so moving to
  // another person's page starts from that person again.
  const [focus, setFocus] = useState<{ recordId?: string; personId: string }>();
  const focusId =
    isDefined(focus) && focus.recordId === recordId ? focus.personId : recordId;
  const skip = !isPerson || !isDefined(recordId) || !isDefined(focusId);

  const { records: people = [] } = useFindManyRecords({
    objectNameSingular: 'person',
    filter: { id: { in: [recordId, focusId].filter(isDefined) } },
    recordGqlFields: { id: true, name: true },
    skip,
  });

  // Walk outwards from the person in focus, one hop per query. Each person's
  // own rows are enough because every link is stored from both sides.
  const { records: firstHop = [], loading: firstHopLoading } =
    useFindManyRecords<FamilyLink & { __typename: string }>({
      objectNameSingular: 'personRelationship',
      filter: { personId: { eq: focusId } },
      recordGqlFields: LINK_GQL_FIELDS,
      skip,
      limit: 200,
    });

  const relatedIds = (links: FamilyLink[], exclude: Set<string>) => [
    ...new Set(
      links
        .map((link) => link.relatedPersonId)
        .filter(isNonEmptyString)
        .filter((id) => !exclude.has(id)),
    ),
  ];

  const firstHopIds = relatedIds(firstHop, new Set([focusId ?? '']));

  const { records: secondHop = [], loading: secondHopLoading } =
    useFindManyRecords<FamilyLink & { __typename: string }>({
      objectNameSingular: 'personRelationship',
      filter: { personId: { in: firstHopIds } },
      recordGqlFields: LINK_GQL_FIELDS,
      skip: skip || firstHopIds.length === 0,
      limit: 500,
    });

  const secondHopIds = relatedIds(
    secondHop,
    new Set([focusId ?? '', ...firstHopIds]),
  );

  const { records: thirdHop = [], loading: thirdHopLoading } =
    useFindManyRecords<FamilyLink & { __typename: string }>({
      objectNameSingular: 'personRelationship',
      filter: { personId: { in: secondHopIds } },
      recordGqlFields: LINK_GQL_FIELDS,
      skip: skip || secondHopIds.length === 0,
      limit: 500,
    });

  const { openRecordInSidePanel } = useOpenRecordInSidePanel();

  if (skip || !isDefined(focusId) || !isDefined(recordId)) {
    return null;
  }

  const nameOf = (id: string) => {
    const name = (people.find((person) => person.id === id)?.name ??
      {}) as PersonName;

    return {
      full: `${name.firstName ?? ''} ${name.lastName ?? ''}`.trim(),
      last: (name.lastName ?? '').trim(),
    };
  };

  const focusName = nameOf(focusId);
  const focusLabel = focusName.full || t`profile`;
  const recordLabel = nameOf(recordId).full || t`this person`;
  const title = isNonEmptyString(focusName.last)
    ? t`${focusName.last} Family`
    : t`Family`;

  const relationLabels: Record<FamilyRelation, string> = {
    self: '',
    parent: t`Parent`,
    grandparent: t`Grandparent`,
    sibling: t`Sibling`,
    halfSibling: t`Half-sibling`,
    partner: t`Spouse / partner`,
    child: t`Child`,
    grandchild: t`Grandchild`,
    parentInLaw: t`Parent-in-law`,
    siblingInLaw: t`Sibling-in-law`,
    childInLaw: t`Child-in-law`,
    auntOrUncle: t`Aunt / uncle`,
    stepParent: t`Step-parent`,
    stepChild: t`Stepchild`,
    nieceOrNephew: t`Niece / nephew`,
    relative: t`Relative`,
  };

  const header = (
    <StyledHeader>
      <StyledTitle>{title}</StyledTitle>
      <StyledActions>
        <StyledAction
          type="button"
          onClick={() =>
            openRecordInSidePanel({
              recordId: focusId,
              objectNameSingular: 'person',
            })
          }
        >
          {t`Open ${focusLabel}`}
        </StyledAction>
        {focusId !== recordId && (
          <StyledAction
            type="button"
            onClick={() => setFocus({ recordId, personId: recordId })}
          >
            {t`Back to ${recordLabel}`}
          </StyledAction>
        )}
      </StyledActions>
    </StyledHeader>
  );

  if (firstHopLoading || secondHopLoading || thirdHopLoading) {
    return (
      <StyledContainer>
        {header}
        <StyledHint>{t`Loading…`}</StyledHint>
      </StyledContainer>
    );
  }

  const graph = buildFamilyGraph(focusId, focusName.full, [
    ...firstHop,
    ...secondHop,
    ...thirdHop,
  ]);

  if (graph.nodes.length <= 1) {
    return (
      <StyledContainer>
        {header}
        <StyledHint>
          {t`No family links yet. Add relatives on the Family field.`}
        </StyledHint>
      </StyledContainer>
    );
  }

  const layout = layoutFamilyGraph(focusId, graph);

  return (
    <StyledContainer>
      {header}
      <StyledHint>{t`Click a relative to see the tree from their side.`}</StyledHint>
      <StyledScroller>
        <StyledCanvas style={{ width: layout.width, height: layout.height }}>
          <StyledLines width={layout.width} height={layout.height}>
            {layout.paths.map((path, index) => (
              <path key={index} d={path} fill="none" strokeWidth={1.5} />
            ))}
          </StyledLines>
          {layout.nodes.map((node) => (
            <StyledMember
              key={node.id}
              type="button"
              title={node.displayName}
              $isFocus={node.id === focusId}
              disabled={node.id === focusId}
              style={{
                left: node.x,
                top: node.y,
                width: FAMILY_NODE_WIDTH,
                height: FAMILY_NODE_HEIGHT,
              }}
              onClick={() => setFocus({ recordId, personId: node.id })}
            >
              <StyledName>{node.displayName || t`Unknown`}</StyledName>
              {isNonEmptyString(relationLabels[node.relation]) && (
                <StyledRelation>{relationLabels[node.relation]}</StyledRelation>
              )}
            </StyledMember>
          ))}
        </StyledCanvas>
      </StyledScroller>
    </StyledContainer>
  );
};
