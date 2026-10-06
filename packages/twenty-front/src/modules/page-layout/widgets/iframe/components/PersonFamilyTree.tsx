import { useLingui } from '@lingui/react/macro';
import { styled } from '@linaria/react';
import { isNonEmptyString } from '@sniptt/guards';
import { useState } from 'react';
import { isDefined } from 'twenty-shared/utils';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { AddRelativeForm } from '@/enso/family-tree/components/AddRelativeForm';
import { FamilyTreeCard } from '@/enso/family-tree/components/FamilyTreeCard';
import { useFamilyTreeLinks } from '@/enso/family-tree/hooks/useFamilyTreeLinks';
import {
  buildFamilyGraph,
  type FamilyRelation,
} from '@/enso/family-tree/utils/buildFamilyGraph';
import { layoutFamilyGraph } from '@/enso/family-tree/utils/layoutFamilyGraph';
import { useDeleteOneRecord } from '@/object-record/hooks/useDeleteOneRecord';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useOpenRecordInSidePanel } from '@/side-panel/hooks/useOpenRecordInSidePanel';
import { useLayoutRenderingContext } from '@/ui/layout/contexts/LayoutRenderingContext';

// ENSO — the family diagram, on a Person's Family tab and on a Family
// (household) record. Couples are joined by a line and each set of parents
// connects to their own children. Clicking a relative re-centres the tree on
// them in place; each card's menu opens the profile or changes / removes the
// link, and "Add relative" adds one in a single step (nothing is saved until
// it is complete). A scoped manager sees only the
// links their visibility rules allow.
export const ENSO_PERSON_FAMILY_TREE_MARKER = '__enso_person_family_tree';

type PersonName = { firstName?: string; lastName?: string };

// Space under the last row so a card's menu is not clipped.
const MENU_ROOM = 120;

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
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledAction = styled.button<{ $isPrimary?: boolean }>`
  background: ${({ $isPrimary }) =>
    $isPrimary
      ? themeCssVariables.color.blue
      : themeCssVariables.background.secondary};
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

export const PersonFamilyTree = () => {
  const { t } = useLingui();
  const { targetRecordIdentifier } = useLayoutRenderingContext();
  const recordId = targetRecordIdentifier?.id;
  const objectName = targetRecordIdentifier?.targetObjectNameSingular;
  const isPerson = objectName === 'person';
  const isHousehold = objectName === 'household';

  // On a Family record, the tree starts from its longest-known member.
  const { records: householdRecords = [] } = useFindManyRecords({
    objectNameSingular: 'household',
    filter: { id: { eq: recordId } },
    recordGqlFields: { id: true, name: true },
    skip: !isHousehold || !isDefined(recordId),
  });
  const { records: members = [], loading: membersLoading } = useFindManyRecords(
    {
      objectNameSingular: 'person',
      filter: { householdId: { eq: recordId } },
      orderBy: [{ createdAt: 'AscNullsLast' }],
      recordGqlFields: { id: true, name: true },
      skip: !isHousehold || !isDefined(recordId),
      limit: 1,
    },
  );
  const startId = isPerson ? recordId : members[0]?.id;

  // Which relative the tree is centred on; tied to the starting person so a
  // different record starts from its own person again.
  const [focus, setFocus] = useState<{ startId?: string; personId: string }>();
  const focusId =
    isDefined(focus) && focus.startId === startId ? focus.personId : startId;

  const { records: people = [] } = useFindManyRecords({
    objectNameSingular: 'person',
    filter: { id: { in: [startId, focusId].filter(isDefined) } },
    recordGqlFields: { id: true, name: true },
    skip: !isDefined(focusId),
  });

  const { ownLinks, links, loading, refetch } = useFamilyTreeLinks(focusId);
  const { openRecordInSidePanel } = useOpenRecordInSidePanel();
  const [isAddingRelative, setIsAddingRelative] = useState(false);
  const { deleteOneRecord } = useDeleteOneRecord({
    objectNameSingular: 'personRelationship',
  });

  if (!isPerson && !isHousehold) {
    return null;
  }

  if (!isDefined(startId) || !isDefined(focusId)) {
    return (
      <StyledContainer>
        <StyledHint>
          {isHousehold && !membersLoading
            ? t`Nobody is in this family any more.`
            : t`Loading…`}
        </StyledHint>
      </StyledContainer>
    );
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
  const householdName = householdRecords[0]?.name as string | undefined;
  const title =
    isHousehold && focusId === startId && isNonEmptyString(householdName)
      ? householdName
      : isNonEmptyString(focusName.last)
        ? t`${focusName.last} Family`
        : t`Family`;
  const startLabel = nameOf(startId).full || t`the start`;
  const focusLabel = focusName.full || t`this person`;

  const directLinkTo = (personId: string) =>
    ownLinks.find(
      (link) => link.personId === focusId && link.relatedPersonId === personId,
    );

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
    <>
      <StyledHeader>
        <StyledTitle>{title}</StyledTitle>
        <StyledActions>
          <StyledAction
            type="button"
            $isPrimary
            onClick={() => setIsAddingRelative((isOpen) => !isOpen)}
          >
            {t`+ Add relative to ${focusLabel}`}
          </StyledAction>
          {focusId !== startId && (
            <StyledAction
              type="button"
              onClick={() => setFocus({ startId, personId: startId })}
            >
              {t`Back to ${startLabel}`}
            </StyledAction>
          )}
        </StyledActions>
      </StyledHeader>
      {isAddingRelative && (
        <AddRelativeForm
          key={focusId}
          focusId={focusId}
          focusName={focusLabel}
          onAdded={async () => {
            setIsAddingRelative(false);
            await refetch();
          }}
          onCancel={() => setIsAddingRelative(false)}
        />
      )}
    </>
  );

  if (loading && links.length === 0) {
    return (
      <StyledContainer>
        {header}
        <StyledHint>{t`Loading…`}</StyledHint>
      </StyledContainer>
    );
  }

  const graph = buildFamilyGraph(focusId, focusName.full, links);

  if (graph.nodes.length <= 1) {
    return (
      <StyledContainer>
        {header}
        <StyledHint>
          {t`No relatives yet. Use "Add relative" to start the family.`}
        </StyledHint>
      </StyledContainer>
    );
  }

  const layout = layoutFamilyGraph(focusId, graph);

  return (
    <StyledContainer>
      {header}
      <StyledHint>
        {t`Click a relative to see the tree from their side. Hover a card for more.`}
      </StyledHint>
      <StyledScroller>
        <StyledCanvas
          style={{ width: layout.width, height: layout.height + MENU_ROOM }}
        >
          <StyledLines width={layout.width} height={layout.height}>
            {layout.paths.map((path, index) => (
              <path key={index} d={path} fill="none" strokeWidth={1.5} />
            ))}
          </StyledLines>
          {layout.nodes.map((node) => {
            const directLink = directLinkTo(node.id);

            return (
              <FamilyTreeCard
                key={node.id}
                name={node.displayName}
                relation={relationLabels[node.relation]}
                x={node.x}
                y={node.y}
                isFocus={node.id === focusId}
                canEditLink={isDefined(directLink)}
                onFocus={() => {
                  setIsAddingRelative(false);
                  setFocus({ startId, personId: node.id });
                }}
                onOpenProfile={() =>
                  openRecordInSidePanel({
                    recordId: node.id,
                    objectNameSingular: 'person',
                  })
                }
                onChangeRelation={() => {
                  if (isDefined(directLink)) {
                    openRecordInSidePanel({
                      recordId: directLink.id,
                      objectNameSingular: 'personRelationship',
                    });
                  }
                }}
                onRemove={async () => {
                  if (isDefined(directLink)) {
                    await deleteOneRecord(directLink.id);
                    await refetch();
                  }
                }}
              />
            );
          })}
        </StyledCanvas>
      </StyledScroller>
    </StyledContainer>
  );
};
