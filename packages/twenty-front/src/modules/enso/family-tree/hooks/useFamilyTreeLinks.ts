import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';

import { type FamilyLink } from '@/enso/family-tree/utils/buildFamilyGraph';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';

const LINK_GQL_FIELDS = {
  id: true,
  name: true,
  personId: true,
  relatedPersonId: true,
  relationType: true,
  relatedPerson: { id: true, name: true },
};

type LinkRecord = FamilyLink & { __typename: string };

const relatedIds = (links: FamilyLink[], exclude: Set<string>) => [
  ...new Set(
    links
      .map((link) => link.relatedPersonId)
      .filter(isNonEmptyString)
      .filter((id) => !exclude.has(id)),
  ),
];

// The family links around one person, walked outwards one hop per query:
// their own links, their relatives' links, and those relatives' links. Each
// person's own rows are enough because every link is stored from both sides.
export const useFamilyTreeLinks = (focusId: string | undefined) => {
  const skip = !isDefined(focusId);

  const firstHop = useFindManyRecords<LinkRecord>({
    objectNameSingular: 'personRelationship',
    filter: { personId: { eq: focusId } },
    recordGqlFields: LINK_GQL_FIELDS,
    skip,
    limit: 200,
  });

  const firstHopIds = relatedIds(firstHop.records, new Set([focusId ?? '']));

  const secondHop = useFindManyRecords<LinkRecord>({
    objectNameSingular: 'personRelationship',
    filter: { personId: { in: firstHopIds } },
    recordGqlFields: LINK_GQL_FIELDS,
    skip: skip || firstHopIds.length === 0,
    limit: 500,
  });

  const secondHopIds = relatedIds(
    secondHop.records,
    new Set([focusId ?? '', ...firstHopIds]),
  );

  const thirdHop = useFindManyRecords<LinkRecord>({
    objectNameSingular: 'personRelationship',
    filter: { personId: { in: secondHopIds } },
    recordGqlFields: LINK_GQL_FIELDS,
    skip: skip || secondHopIds.length === 0,
    limit: 500,
  });

  // The server mirrors and tidies links on its own, so after a change the
  // cached hops can disagree with each other until they are fetched again.
  const refetch = async () => {
    await Promise.all(
      [firstHop, secondHop, thirdHop].map((hop) =>
        hop.refetch?.().catch(() => undefined),
      ),
    );
  };

  return {
    // The person in focus's own links, for acting on a direct relative.
    ownLinks: firstHop.records,
    links: [...firstHop.records, ...secondHop.records, ...thirdHop.records],
    loading: firstHop.loading || secondHop.loading || thirdHop.loading,
    refetch,
  };
};
