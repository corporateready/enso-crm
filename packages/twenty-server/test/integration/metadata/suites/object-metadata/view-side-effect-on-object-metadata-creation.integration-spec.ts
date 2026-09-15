import { CUSTOM_OBJECT_DISHES } from 'test/integration/metadata/suites/object-metadata/constants/custom-object-dishes.constants';
import { type CreateOneObjectFactoryInput } from 'test/integration/metadata/suites/object-metadata/utils/create-one-object-metadata-query-factory.util';
import { createOneObjectMetadata } from 'test/integration/metadata/suites/object-metadata/utils/create-one-object-metadata.util';
import { deleteOneObjectMetadata } from 'test/integration/metadata/suites/object-metadata/utils/delete-one-object-metadata.util';
import { updateOneObjectMetadata } from 'test/integration/metadata/suites/object-metadata/utils/update-one-object-metadata.util';
import { findViewFields } from 'test/integration/metadata/suites/view-field/utils/find-view-fields.util';
import { findViews } from 'test/integration/metadata/suites/view/utils/find-views.util';
import { ViewKey } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { type FlatView } from 'src/engine/metadata-modules/flat-view/types/flat-view.type';

describe('View side effect on object creation', () => {
  let createdObjectMetadataId: string | undefined = undefined;

  afterEach(async () => {
    if (!isDefined(createdObjectMetadataId)) {
      return;
    }
    await updateOneObjectMetadata({
      expectToFail: false,
      input: {
        idToUpdate: createdObjectMetadataId,
        updatePayload: {
          isActive: false,
        },
      },
    });

    await deleteOneObjectMetadata({
      input: { idToDelete: createdObjectMetadataId },
      expectToFail: false,
    });

    createdObjectMetadataId = undefined;
  });
  it('should create a view and view field for default custom objects standard fields on object metadata creation', async () => {
    const {
      labelPlural,
      description,
      labelSingular,
      namePlural,
      nameSingular,
    } = CUSTOM_OBJECT_DISHES;
    const createObjectInput: CreateOneObjectFactoryInput = {
      labelPlural,
      description,
      labelSingular,
      namePlural,
      nameSingular,
      icon: 'IconBuildingSkyscraper',
      isLabelSyncedWithName: false,
    };
    const objectCreationGqlFields = `
      id
      labelPlural
      description
      labelSingular
      namePlural
      nameSingular
      icon
      isLabelSyncedWithName
    `;

    const {
      data: { createOneObject },
    } = await createOneObjectMetadata({
      expectToFail: false,
      input: createObjectInput,
      gqlFields: objectCreationGqlFields,
    });

    createdObjectMetadataId = createOneObject.id;

    const {
      data: { getViews: createdViews },
    } = await findViews({
      objectMetadataId: createdObjectMetadataId,
      expectToFail: false,
    });

    expect(createdViews).toBeDefined();
    expect(createdViews.length).toBe(2);

    // Creating an object makes TWO views with different field counts — the
    // record-list table (ViewKey.INDEX) and the record-page field list — and
    // getViews returns them unordered: ViewService.getFilteredFlatViews maps
    // Object.values() over an in-memory cache, with no ORDER BY and no sort.
    // Taking createdViews[0] therefore asserted against whichever view the
    // cache happened to list first, and flaked between 5 and 4 fields.
    const indexView = createdViews.find((view) => view.key === ViewKey.INDEX);

    if (!isDefined(indexView)) {
      throw new Error(
        `Expected an INDEX view for object ${createdObjectMetadataId}, got keys: ${createdViews
          .map((view) => view.key)
          .join(', ')}`,
      );
    }

    expect(indexView).toMatchObject<Partial<FlatView>>({
      objectMetadataId: createdObjectMetadataId,
    });

    const {
      data: { getViewFields: createdViewFields },
    } = await findViewFields({
      viewId: indexView.id,
      expectToFail: false,
    });

    expect(createdViewFields.length).toBe(5);
  });
});
