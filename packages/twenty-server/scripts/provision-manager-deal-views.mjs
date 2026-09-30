#!/usr/bin/env node
// Lays out the prepared opportunity views every manager starts from:
//
//   Active Deals List    mine, Active, not closed        (was "My Opportunities")
//   Active Deals Kanban  mine, Active, not closed, by stage
//   Stalled Kanban       mine, Stalled, not closed, by stage
//   Deferred Kanban      mine, Deferred, not closed, by stage
//   All Deals List       everything the viewer may see   (was "All Opportunities", INDEX)
//   All Deals Kanban     everything, by stage            (was "By Stage")
//
// These are ordinary WORKSPACE views, not a cage: anyone can still create
// their own views, edit these, and pin a personal default. Which one a role
// OPENS on is a separate setting — run provision-role-default-views.mjs with
// --map=opportunity=Active\ Deals\ List afterwards.
//
// Closing a deal does not touch pipelineState, so hundreds of Closed Lost
// deals still read ACTIVE. The three state views therefore also exclude the
// closed stages, or "Active Deals" would be mostly lost ones. The kanbans keep
// the closed columns as drop targets; a card dropped there leaves the view.
//
// Idempotent. Views are found by their current OR previous name, renamed and
// reordered in place (so ids, and anything pointing at them, survive), and
// their filters are reconciled to exactly the set below. New views copy their
// columns, grouping and aggregate from the matching existing list/kanban,
// because a view with no viewFields renders blank.
//
// Usage:
//   TWENTY_API_URL=https://crm.enso.ro TWENTY_API_KEY=<workspace api key> \
//   node packages/twenty-server/scripts/provision-manager-deal-views.mjs [--dry-run] [--prune]
//
//   --dry-run  print the plan without writing
//   --prune    soft-delete any other workspace opportunity list/kanban view

const API_URL = (process.env.TWENTY_API_URL ?? 'https://crm.enso.ro').replace(
  /\/$/,
  '',
);
const API_KEY = process.env.TWENTY_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');
const PRUNE = process.argv.includes('--prune');

if (!API_KEY) {
  console.error('Missing TWENTY_API_KEY env var (workspace API key).');
  process.exit(1);
}

const CLOSED_STAGES = ['CLOSED_WON', 'CLOSED_LOST'];

const mine = { field: 'owner', operand: 'IS', value: ['currentWorkspaceMember'] };
const openStage = { field: 'stage', operand: 'IS_NOT', value: CLOSED_STAGES };
const inState = (state) => ({
  field: 'pipelineState',
  operand: 'IS',
  value: [state],
});

const VIEW_SET = [
  {
    name: 'Active Deals List',
    previousNames: ['My Opportunities'],
    type: 'TABLE',
    icon: 'IconBriefcase',
    filters: [mine, inState('ACTIVE'), openStage],
  },
  {
    name: 'Active Deals Kanban',
    type: 'KANBAN',
    icon: 'IconLayoutKanban',
    filters: [mine, inState('ACTIVE'), openStage],
  },
  {
    name: 'Stalled Kanban',
    type: 'KANBAN',
    icon: 'IconHourglassHigh',
    filters: [mine, inState('STALLED'), openStage],
  },
  {
    name: 'Deferred Kanban',
    type: 'KANBAN',
    icon: 'IconCalendarTime',
    filters: [mine, inState('DEFERRED'), openStage],
  },
  {
    name: 'All Deals List',
    previousNames: ['All Opportunities'],
    type: 'TABLE',
    icon: 'IconList',
    filters: [],
  },
  {
    name: 'All Deals Kanban',
    previousNames: ['By Stage'],
    type: 'KANBAN',
    icon: 'IconLayoutKanban',
    filters: [],
  },
];

const request = async (query, variables) => {
  const response = await fetch(`${API_URL}/metadata`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = await response.json();

  if (body.errors) {
    throw new Error(JSON.stringify(body.errors, null, 2));
  }

  return body.data;
};

const write = async (description, query, variables) => {
  console.log(`  ${DRY_RUN ? '[dry-run] ' : ''}${description}`);

  if (DRY_RUN) return undefined;

  return request(query, variables);
};

const VIEW_DETAIL = `
  query View($id: String!) {
    getView(id: $id) {
      id name icon type key position visibility
      mainGroupByFieldMetadataId kanbanAggregateOperation
      kanbanAggregateOperationFieldMetadataId shouldHideEmptyGroups openRecordIn
      viewFilters { id fieldMetadataId operand value viewFilterGroupId }
      viewSorts { id fieldMetadataId direction }
      viewGroups { id fieldValue isVisible position }
    }
    getViewFields(viewId: $id) {
      fieldMetadataId isVisible size position aggregateOperation
    }
  }
`;

const loadView = async (id) => {
  const data = await request(VIEW_DETAIL, { id });

  return { ...data.getView, viewFields: data.getViewFields };
};

const filterKey = (fieldMetadataId, operand, value) =>
  `${fieldMetadataId}|${operand}|${JSON.stringify([...value].sort())}`;

const main = async () => {
  const { objects } = await request(
    `query { objects(paging: { first: 500 }) { edges { node { id nameSingular } } } }`,
  );
  const opportunity = objects.edges
    .map((edge) => edge.node)
    .find((object) => object.nameSingular === 'opportunity');

  const { fields } = await request(
    `query Fields($id: UUID!) {
      fields(paging: { first: 500 }, filter: { objectMetadataId: { eq: $id } }) {
        edges { node { id name } }
      }
    }`,
    { id: opportunity.id },
  );
  const fieldIdByName = new Map(
    fields.edges.map((edge) => [edge.node.name, edge.node.id]),
  );

  const { getViews } = await request(
    `query { getViews { id name key type visibility objectMetadataId } }`,
  );
  const candidates = getViews.filter(
    (view) =>
      view.objectMetadataId === opportunity.id &&
      view.visibility === 'WORKSPACE' &&
      (view.type === 'TABLE' || view.type === 'KANBAN'),
  );

  const findExisting = (spec) =>
    candidates.find((view) => view.name === spec.name) ??
    candidates.find((view) => spec.previousNames?.includes(view.name));

  // Layout templates for the views that do not exist yet: the prepared list
  // and kanban that already carry the columns people are used to.
  const templateFor = async (type) => {
    const spec = VIEW_SET.find(
      (candidate) => candidate.type === type && findExisting(candidate),
    );

    return spec ? loadView(findExisting(spec).id) : undefined;
  };
  const templates = {
    TABLE: await templateFor('TABLE'),
    KANBAN: await templateFor('KANBAN'),
  };

  const managedIds = new Set();

  for (const [position, spec] of VIEW_SET.entries()) {
    console.log(`\n${spec.name}`);

    const existing = findExisting(spec);
    let viewId = existing?.id;

    if (!existing) {
      const template = templates[spec.type];

      if (!template) {
        throw new Error(`No existing ${spec.type} view to copy a layout from.`);
      }

      viewId = crypto.randomUUID();

      await write(
        `create ${spec.type} view (layout from "${template.name}")`,
        `mutation Create($input: CreateViewInput!) { createView(input: $input) { id } }`,
        {
          input: {
            id: viewId,
            name: spec.name,
            objectMetadataId: opportunity.id,
            type: spec.type,
            icon: spec.icon,
            position,
            visibility: 'WORKSPACE',
            openRecordIn: template.openRecordIn,
            mainGroupByFieldMetadataId: template.mainGroupByFieldMetadataId,
            kanbanAggregateOperation: template.kanbanAggregateOperation,
            kanbanAggregateOperationFieldMetadataId:
              template.kanbanAggregateOperationFieldMetadataId,
            shouldHideEmptyGroups: template.shouldHideEmptyGroups,
          },
        },
      );

      await write(
        `copy ${template.viewFields.length} columns`,
        `mutation Fields($inputs: [CreateViewFieldInput!]!) { createManyViewFields(inputs: $inputs) { id } }`,
        {
          inputs: template.viewFields.map((viewField) => ({
            viewId,
            fieldMetadataId: viewField.fieldMetadataId,
            isVisible: viewField.isVisible,
            size: viewField.size,
            position: viewField.position,
            aggregateOperation: viewField.aggregateOperation,
          })),
        },
      );

      for (const sort of template.viewSorts) {
        await write(
          `copy sort ${sort.direction}`,
          `mutation Sort($input: CreateViewSortInput!) { createViewSort(input: $input) { id } }`,
          {
            input: {
              viewId,
              fieldMetadataId: sort.fieldMetadataId,
              direction: sort.direction,
            },
          },
        );
      }

      // createView may already have generated the stage columns; only copy
      // them across when it did not.
      const created = DRY_RUN ? undefined : await loadView(viewId);

      if (template.viewGroups.length > 0 && created?.viewGroups.length === 0) {
        await write(
          `copy ${template.viewGroups.length} kanban columns`,
          `mutation Groups($inputs: [CreateViewGroupInput!]!) { createManyViewGroups(inputs: $inputs) { id } }`,
          {
            inputs: template.viewGroups.map((viewGroup) => ({
              viewId,
              fieldValue: viewGroup.fieldValue,
              isVisible: viewGroup.isVisible,
              position: viewGroup.position,
            })),
          },
        );
      }
    } else if (
      existing.name !== spec.name ||
      (await loadView(existing.id)).position !== position
    ) {
      await write(
        `rename/reorder "${existing.name}" -> "${spec.name}" at ${position}`,
        `mutation Update($id: String!, $input: UpdateViewInput!) { updateView(id: $id, input: $input) { id } }`,
        { id: existing.id, input: { name: spec.name, icon: spec.icon, position } },
      );
    }

    managedIds.add(viewId);

    const current = existing ? await loadView(existing.id) : { viewFilters: [] };
    const wanted = spec.filters.map((filter) => {
      const fieldMetadataId = fieldIdByName.get(filter.field);

      if (!fieldMetadataId) {
        throw new Error(`opportunity has no field "${filter.field}"`);
      }

      return { ...filter, fieldMetadataId };
    });
    const wantedKeys = new Set(
      wanted.map((filter) =>
        filterKey(filter.fieldMetadataId, filter.operand, filter.value),
      ),
    );
    const currentKeys = new Set();

    for (const viewFilter of current.viewFilters) {
      const value = Array.isArray(viewFilter.value)
        ? viewFilter.value
        : JSON.parse(viewFilter.value);
      const key = filterKey(viewFilter.fieldMetadataId, viewFilter.operand, value);

      if (wantedKeys.has(key) && !viewFilter.viewFilterGroupId) {
        currentKeys.add(key);
        continue;
      }

      await write(
        `remove filter ${viewFilter.operand} ${JSON.stringify(value)}`,
        `mutation Delete($input: DeleteViewFilterInput!) { deleteViewFilter(input: $input) { id } }`,
        { input: { id: viewFilter.id } },
      );
    }

    for (const filter of wanted) {
      const key = filterKey(filter.fieldMetadataId, filter.operand, filter.value);

      if (currentKeys.has(key)) continue;

      await write(
        `add filter ${filter.field} ${filter.operand} ${JSON.stringify(filter.value)}`,
        `mutation Filter($input: CreateViewFilterInput!) { createViewFilter(input: $input) { id } }`,
        {
          input: {
            viewId,
            fieldMetadataId: filter.fieldMetadataId,
            operand: filter.operand,
            value: filter.value,
          },
        },
      );
    }
  }

  const strays = candidates.filter((view) => !managedIds.has(view.id));

  if (strays.length > 0) {
    console.log(`\nOther workspace opportunity views:`);

    for (const view of strays) {
      if (!PRUNE) {
        console.log(`  keep "${view.name}" (${view.id}) — pass --prune to remove`);
        continue;
      }

      await write(
        `soft-delete "${view.name}" (${view.id})`,
        `mutation Delete($id: String!) { deleteView(id: $id) }`,
        { id: view.id },
      );
    }
  }

  console.log(DRY_RUN ? '\n--dry-run: nothing written.' : '\nDone.');
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
