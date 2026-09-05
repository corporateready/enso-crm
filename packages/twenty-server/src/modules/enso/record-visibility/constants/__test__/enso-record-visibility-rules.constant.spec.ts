import { ENSO_RECORD_VISIBILITY_RULES } from 'src/modules/enso/record-visibility/constants/enso-record-visibility-rules.constant';
import { type EnsoRecordVisibilityConditionArgs } from 'src/modules/enso/record-visibility/types/enso-record-visibility-rule.type';

const args: EnsoRecordVisibilityConditionArgs = {
  ref: (columnName) => `"person"."${columnName}"`,
  schema: '"workspace_test"',
  me: ':memberId',
};

const objectNames = Object.keys(ENSO_RECORD_VISIBILITY_RULES);

// These rules decide who can see whose customers, and a rule that quietly stops
// referring to the current member stops filtering anything — it just returns
// every row. The SQL itself is verified against a real database; what is
// guarded here is that no rule can be added or edited into that shape.
describe('ENSO_RECORD_VISIBILITY_RULES', () => {
  it.each(objectNames)(
    'should bind the current member in the %s rule',
    (objectName) => {
      const condition =
        ENSO_RECORD_VISIBILITY_RULES[objectName].buildCondition(args);

      expect(condition).toContain(':memberId');
    },
  );

  it.each(objectNames)(
    'should address the filtered row through ref in the %s rule',
    (objectName) => {
      const condition =
        ENSO_RECORD_VISIBILITY_RULES[objectName].buildCondition(args);

      // An unqualified column inside a correlated subquery resolves against the
      // subquery instead of the row being filtered, which silently inverts the
      // rule. Every rule has to reach the row through `ref`, which is what
      // keeps the reference qualified in both the aliased and the direct form.
      expect(condition).toContain('"person"."');
    },
  );

  it('should scope the objects that carry someone else’s field values', () => {
    // timelineActivity holds a diff of the record it describes; the consent and
    // activity tables hold contact behaviour. Losing any of these from the map
    // leaks the contents of records a manager cannot open.
    expect(objectNames).toEqual(
      expect.arrayContaining([
        'person',
        'opportunity',
        'inboundActivity',
        'outboundActivity',
        'timelineActivity',
        'personProjectConsent',
        'personProjectConsentEvent',
        'note',
        'attachment',
      ]),
    );
  });
});
