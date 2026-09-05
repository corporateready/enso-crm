import {
  type EnsoRecordVisibilityConditionArgs,
  type EnsoRecordVisibilityRule,
} from 'src/modules/enso/record-visibility/types/enso-record-visibility-rule.type';

// A scoped member owns a contact through the project x contact assignment, and
// through being the owner of a deal that contact is the point of contact for.
const ownedPersonIds = ({ schema, me }: EnsoRecordVisibilityConditionArgs) => `
  SELECT ppa."personId"
  FROM ${schema}."_personProjectAssignment" ppa
  WHERE ppa."deletedAt" IS NULL AND ppa."managerId" = ${me}
  UNION
  SELECT opp."pointOfContactId"
  FROM ${schema}."opportunity" opp
  WHERE opp."deletedAt" IS NULL
    AND opp."ownerId" = ${me}
    AND opp."pointOfContactId" IS NOT NULL
`;

const ownedOpportunityIds = ({
  schema,
  me,
}: EnsoRecordVisibilityConditionArgs) => `
  SELECT opp."id"
  FROM ${schema}."opportunity" opp
  WHERE opp."deletedAt" IS NULL AND opp."ownerId" = ${me}
`;

const ownedCompanyIds = ({ schema, me }: EnsoRecordVisibilityConditionArgs) => `
  SELECT cpa."companyId"
  FROM ${schema}."_companyProjectAssignment" cpa
  WHERE cpa."deletedAt" IS NULL AND cpa."managerId" = ${me}
`;

const ownedAssignmentIds = ({
  schema,
  me,
}: EnsoRecordVisibilityConditionArgs) => `
  SELECT ppa."id"
  FROM ${schema}."_personProjectAssignment" ppa
  WHERE ppa."deletedAt" IS NULL AND ppa."managerId" = ${me}
`;

const personColumnIsOwned = (
  args: EnsoRecordVisibilityConditionArgs,
  columnName: string,
) => `${args.ref(columnName)} IN (${ownedPersonIds(args)})`;

// personProjectConsentEvent stores its person id as denormalized text rather
// than a relation, so the owned ids are widened instead of the column being
// cast — a malformed value must not blow up the whole query.
const personTextColumnIsOwned = (
  args: EnsoRecordVisibilityConditionArgs,
  columnName: string,
) =>
  `${args.ref(columnName)} IN (SELECT owned."personId"::text FROM (${ownedPersonIds(
    args,
  )}) AS owned("personId"))`;

const opportunityColumnIsOwned = (
  args: EnsoRecordVisibilityConditionArgs,
  columnName: string,
) => `${args.ref(columnName)} IN (${ownedOpportunityIds(args)})`;

const wasCreatedByMe = ({ ref, me }: EnsoRecordVisibilityConditionArgs) =>
  `${ref('createdByWorkspaceMemberId')} = ${me}`;

const anyOf = (conditions: string[]) =>
  `(${conditions.map((condition) => `(${condition})`).join(' OR ')})`;

// A target table (noteTarget, taskTarget, attachment) is visible when any of
// the records it points at is visible to the scoped member.
const targetRowIsOwned = (args: EnsoRecordVisibilityConditionArgs) =>
  anyOf([
    personColumnIsOwned(args, 'targetPersonId'),
    opportunityColumnIsOwned(args, 'targetOpportunityId'),
    `${args.ref('targetCompanyId')} IN (${ownedCompanyIds(args)})`,
    `${args.ref('targetPersonProjectAssignmentId')} IN (${ownedAssignmentIds(
      args,
    )})`,
  ]);

const hasOwnedTarget = (
  args: EnsoRecordVisibilityConditionArgs,
  {
    targetTable,
    foreignKeyColumn,
  }: { targetTable: string; foreignKeyColumn: string },
) => {
  const targetArgs: EnsoRecordVisibilityConditionArgs = {
    ...args,
    ref: (columnName) => `tgt."${columnName}"`,
  };

  return `EXISTS (
    SELECT 1 FROM ${args.schema}."${targetTable}" tgt
    WHERE tgt."${foreignKeyColumn}" = ${args.ref('id')}
      AND tgt."deletedAt" IS NULL
      AND ${targetRowIsOwned(targetArgs)}
  )`;
};

// Objects absent from this map are not record-scoped: they are either reference
// data every manager needs (project, company, workspaceMember) or hidden
// wholesale by object-level permissions on the role.
export const ENSO_RECORD_VISIBILITY_RULES: Record<
  string,
  EnsoRecordVisibilityRule
> = {
  person: {
    buildCondition: (args) =>
      anyOf([
        `${args.ref('id')} IN (${ownedPersonIds(args)})`,
        // A contact you just created, before routing has assigned it to
        // anyone. Drops away as soon as it belongs to someone.
        `${wasCreatedByMe(args)} AND NOT EXISTS (
          SELECT 1 FROM ${args.schema}."_personProjectAssignment" ppa2
          WHERE ppa2."personId" = ${args.ref('id')}
            AND ppa2."deletedAt" IS NULL
            AND ppa2."managerId" IS NOT NULL
        )`,
      ]),
  },
  opportunity: {
    buildCondition: ({ ref, me }) => `${ref('ownerId')} = ${me}`,
  },
  personProjectAssignment: {
    buildCondition: ({ ref, me }) => `${ref('managerId')} = ${me}`,
  },
  companyProjectAssignment: {
    buildCondition: ({ ref, me }) => `${ref('managerId')} = ${me}`,
  },
  task: {
    buildCondition: (args) =>
      anyOf([`${args.ref('assigneeId')} = ${args.me}`, wasCreatedByMe(args)]),
  },
  note: {
    buildCondition: (args) =>
      anyOf([
        wasCreatedByMe(args),
        hasOwnedTarget(args, {
          targetTable: 'noteTarget',
          foreignKeyColumn: 'noteId',
        }),
      ]),
  },
  outboundActivity: {
    buildCondition: (args) =>
      anyOf([
        `${args.ref('performedById')} = ${args.me}`,
        personColumnIsOwned(args, 'personId'),
        opportunityColumnIsOwned(args, 'opportunityId'),
      ]),
  },
  inboundActivity: {
    buildCondition: (args) =>
      anyOf([
        personColumnIsOwned(args, 'personId'),
        opportunityColumnIsOwned(args, 'opportunityId'),
      ]),
  },
  dealStateHistory: {
    buildCondition: (args) => opportunityColumnIsOwned(args, 'opportunityId'),
  },
  personProjectConsent: {
    buildCondition: (args) => personColumnIsOwned(args, 'personId'),
  },
  personProjectConsentEvent: {
    buildCondition: (args) => personTextColumnIsOwned(args, 'personId'),
  },
  personRelationship: {
    buildCondition: (args) =>
      anyOf([
        personColumnIsOwned(args, 'personId'),
        personColumnIsOwned(args, 'relatedPersonId'),
      ]),
  },
  sequenceRun: {
    buildCondition: (args) => opportunityColumnIsOwned(args, 'opportunityId'),
  },
  marketingEnrollment: {
    buildCondition: (args) => personColumnIsOwned(args, 'personId'),
  },
  noteTarget: {
    buildCondition: (args) => targetRowIsOwned(args),
  },
  taskTarget: {
    buildCondition: (args) => targetRowIsOwned(args),
  },
  attachment: {
    buildCondition: (args) =>
      anyOf([wasCreatedByMe(args), targetRowIsOwned(args)]),
  },
  // Timeline rows carry a `properties` diff of the record they describe, so an
  // unscoped timeline hands over field values for records the manager cannot
  // open. Anything targeting something outside the three record roots stays
  // hidden, which is the safe direction for an audit trail.
  timelineActivity: {
    buildCondition: (args) => targetRowIsOwned(args),
  },
};
