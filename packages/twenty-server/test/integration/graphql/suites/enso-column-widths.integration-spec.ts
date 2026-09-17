import request from 'supertest';
import {
  cleanupViewFieldTest,
  setupViewFieldTest,
  type ViewFieldTestSetup,
} from 'test/integration/graphql/suites/view/utils/setup-view-field-test.util';

const client = request(`http://localhost:${APP_PORT}`);

// The member here is on the default Member role: canUpdateAllSettings false
// and no permission flags — the same shape as a sales manager role, and the
// shape whose resize the client used to discard (useSaveCurrentViewFields
// early-returns when canPersistChanges is false). A width is this person's own
// setting, so the mutation asks for nothing beyond being signed in.
let VIEW_ID: string;
let FIELD_METADATA_ID: string;

const setMyColumnWidth = (accessToken: string, size: number | null) =>
  client
    .post('/metadata')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      query: `
        mutation EnsoSetMyColumnWidth($viewId: String!, $fieldMetadataId: String!, $size: Int) {
          ensoSetMyColumnWidth(viewId: $viewId, fieldMetadataId: $fieldMetadataId, size: $size) {
            viewId
            fieldMetadataId
            size
          }
        }
      `,
      variables: { viewId: VIEW_ID, fieldMetadataId: FIELD_METADATA_ID, size },
    });

const getPersonalColumnWidths = (accessToken: string) =>
  client
    .post('/metadata')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      query: `
        query EnsoViewerScope {
          ensoViewerScope {
            personalColumnWidths {
              viewId
              fieldMetadataId
              size
            }
          }
        }
      `,
    });

describe('Enso personal column widths', () => {
  let testSetup: ViewFieldTestSetup;

  // A real view and field rather than invented ids, so the widths are keyed on
  // the same shape the table keys them on.
  beforeAll(async () => {
    testSetup = await setupViewFieldTest();

    VIEW_ID = testSetup.testViewId;
    FIELD_METADATA_ID = testSetup.testFieldMetadataId;
  });

  afterAll(async () => {
    await setMyColumnWidth(APPLE_JONY_MEMBER_ACCESS_TOKEN, null);
    await setMyColumnWidth(APPLE_JANE_ADMIN_ACCESS_TOKEN, null);
    await cleanupViewFieldTest(testSetup.testObjectMetadataId);
  });

  it('should let a member without the VIEWS permission store a column width', async () => {
    const response = await setMyColumnWidth(
      APPLE_JONY_MEMBER_ACCESS_TOKEN,
      260,
    ).expect(200);

    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.ensoSetMyColumnWidth).toEqual([
      { viewId: VIEW_ID, fieldMetadataId: FIELD_METADATA_ID, size: 260 },
    ]);
  });

  it('should give the member their width back on the next load', async () => {
    const response = await getPersonalColumnWidths(
      APPLE_JONY_MEMBER_ACCESS_TOKEN,
    ).expect(200);

    expect(response.body.data.ensoViewerScope.personalColumnWidths).toEqual([
      { viewId: VIEW_ID, fieldMetadataId: FIELD_METADATA_ID, size: 260 },
    ]);
  });

  it("should keep one person's width out of everyone else's table", async () => {
    const response = await getPersonalColumnWidths(
      APPLE_JANE_ADMIN_ACCESS_TOKEN,
    ).expect(200);

    expect(response.body.data.ensoViewerScope.personalColumnWidths).toEqual([]);
  });

  it('should replace the width when that member drags the same column again', async () => {
    const response = await setMyColumnWidth(
      APPLE_JONY_MEMBER_ACCESS_TOKEN,
      340,
    ).expect(200);

    expect(response.body.data.ensoSetMyColumnWidth).toEqual([
      { viewId: VIEW_ID, fieldMetadataId: FIELD_METADATA_ID, size: 340 },
    ]);
  });

  it('should clamp a width that would leave the column unusable', async () => {
    const response = await setMyColumnWidth(
      APPLE_JONY_MEMBER_ACCESS_TOKEN,
      2,
    ).expect(200);

    expect(response.body.data.ensoSetMyColumnWidth).toEqual([
      { viewId: VIEW_ID, fieldMetadataId: FIELD_METADATA_ID, size: 104 },
    ]);
  });

  it('should hand the column back to the view when the width is cleared', async () => {
    const clearResponse = await setMyColumnWidth(
      APPLE_JONY_MEMBER_ACCESS_TOKEN,
      null,
    ).expect(200);

    expect(clearResponse.body.data.ensoSetMyColumnWidth).toEqual([]);

    const readResponse = await getPersonalColumnWidths(
      APPLE_JONY_MEMBER_ACCESS_TOKEN,
    ).expect(200);

    expect(readResponse.body.data.ensoViewerScope.personalColumnWidths).toEqual(
      [],
    );
  });
});
