import request from 'supertest';
import {
  cleanupViewFieldTest,
  setupViewFieldTest,
  type ViewFieldTestSetup,
} from 'test/integration/graphql/suites/view/utils/setup-view-field-test.util';
import { ViewVisibility } from 'twenty-shared/types';

// Upstream lists VIEWS in TOOL_PERMISSION_FLAGS, which makes PermissionsService
// resolve it from role.canAccessAllTools rather than canUpdateAllSettings. Every
// default Member role and every role the Roles UI creates starts with
// canAccessAllTools switched on, so a member with no permission flags at all was
// silently granted "create, edit and delete workspace views" — on our own
// production roles too (Member and Sales Manager). We dropped VIEWS from that
// list; this suite is what fails if it ever comes back, here or in a merge from
// upstream.
//
// Jony is on the default Member role: canUpdateAllSettings false,
// canAccessAllTools true, zero rows in core."rolePermissionFlag".

const client = request(`http://localhost:${APP_PORT}`);

const MODIFY_DENIED = 'You do not have permission to modify this view';
const CREATE_DENIED =
  'You do not have permission to create workspace-level views';

const post = (
  token: string,
  query: string,
  variables: Record<string, unknown>,
) =>
  client
    .post('/metadata')
    .set('Authorization', `Bearer ${token}`)
    .send({ query, variables });

const asMember = (query: string, variables: Record<string, unknown>) =>
  post(APPLE_JONY_MEMBER_ACCESS_TOKEN, query, variables);

const asAdmin = (query: string, variables: Record<string, unknown>) =>
  post(APPLE_JANE_ADMIN_ACCESS_TOKEN, query, variables);

const CREATE_VIEW = `
  mutation ($input: CreateViewInput!) {
    createView(input: $input) { id name visibility }
  }
`;

const UPDATE_VIEW = `
  mutation ($id: String!, $input: UpdateViewInput!) {
    updateView(id: $id, input: $input) { id name }
  }
`;

const DELETE_VIEW = `mutation ($id: String!) { deleteView(id: $id) }`;

const CREATE_VIEW_FIELD = `
  mutation ($input: CreateViewFieldInput!) {
    createViewField(input: $input) { id size }
  }
`;

const UPDATE_VIEW_FIELD = `
  mutation ($input: UpdateViewFieldInput!) {
    updateViewField(input: $input) { id size }
  }
`;

const DELETE_VIEW_FIELD = `
  mutation ($input: DeleteViewFieldInput!) {
    deleteViewField(input: $input) { id }
  }
`;

// A denied mutation must come back as an error AND no data — the guard has to
// stop the write, not just annotate it.
const expectDenied = (body: any, message: string) => {
  expect(body.errors?.map((error: any) => error.message)).toEqual([message]);
  expect(body.data).toBeNull();
};

describe('Shared views are closed to a member without the VIEWS permission', () => {
  let testSetup: ViewFieldTestSetup;
  let sharedViewFieldId: string;

  beforeAll(async () => {
    testSetup = await setupViewFieldTest();

    const response = await asAdmin(CREATE_VIEW_FIELD, {
      input: {
        fieldMetadataId: testSetup.testFieldMetadataId,
        viewId: testSetup.testViewId,
        position: 0,
        isVisible: true,
        size: 100,
      },
    });

    sharedViewFieldId = response.body.data.createViewField.id;
  });

  afterAll(async () => {
    await cleanupViewFieldTest(testSetup.testObjectMetadataId);
  });

  it('should refuse to create a workspace-visible view', async () => {
    const response = await asMember(CREATE_VIEW, {
      input: {
        name: 'memberWorkspaceView',
        icon: 'Icon123',
        objectMetadataId: testSetup.testObjectMetadataId,
      },
    });

    expectDenied(response.body, CREATE_DENIED);
  });

  it("should refuse to rename someone else's shared view", async () => {
    const response = await asMember(UPDATE_VIEW, {
      id: testSetup.testViewId,
      input: { name: 'renamedByMember' },
    });

    expectDenied(response.body, MODIFY_DENIED);
  });

  it("should refuse to delete someone else's shared view", async () => {
    const response = await asMember(DELETE_VIEW, { id: testSetup.testViewId });

    expectDenied(response.body, MODIFY_DENIED);
  });

  it('should refuse to add a field to a shared view', async () => {
    const response = await asMember(CREATE_VIEW_FIELD, {
      input: {
        fieldMetadataId: testSetup.testFieldMetadataId,
        viewId: testSetup.testViewId,
        position: 1,
        isVisible: true,
        size: 180,
      },
    });

    expectDenied(response.body, MODIFY_DENIED);
  });

  it('should refuse to resize a field on a shared view', async () => {
    const response = await asMember(UPDATE_VIEW_FIELD, {
      input: { id: sharedViewFieldId, update: { size: 260 } },
    });

    expectDenied(response.body, MODIFY_DENIED);
  });

  it('should refuse to remove a field from a shared view', async () => {
    const response = await asMember(DELETE_VIEW_FIELD, {
      input: { id: sharedViewFieldId },
    });

    expectDenied(response.body, MODIFY_DENIED);
  });

  // The point of the flag is to protect what everyone shares, not to take
  // people's own views away — so this has to keep working.
  it('should still let that member own and edit an unlisted view', async () => {
    const created = await asMember(CREATE_VIEW, {
      input: {
        name: 'memberUnlistedView',
        icon: 'Icon123',
        objectMetadataId: testSetup.testObjectMetadataId,
        visibility: ViewVisibility.UNLISTED,
      },
    });

    expect(created.body.errors).toBeUndefined();
    expect(created.body.data.createView.visibility).toBe(
      ViewVisibility.UNLISTED,
    );

    const renamed = await asMember(UPDATE_VIEW, {
      id: created.body.data.createView.id,
      input: { name: 'memberUnlistedViewRenamed' },
    });

    expect(renamed.body.errors).toBeUndefined();
    expect(renamed.body.data.updateView.name).toBe('memberUnlistedViewRenamed');
  });

  it('should leave the admin able to manage the same shared view', async () => {
    const response = await asAdmin(UPDATE_VIEW_FIELD, {
      input: { id: sharedViewFieldId, update: { size: 260 } },
    });

    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.updateViewField.size).toBe(260);
  });
});
