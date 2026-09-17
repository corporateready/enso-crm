import { Field, InputType, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('EnsoDefaultView')
export class EnsoDefaultViewDTO {
  @Field(() => String)
  objectMetadataId: string;

  @Field(() => String)
  viewId: string;
}

@ObjectType('EnsoColumnWidth')
export class EnsoColumnWidthDTO {
  @Field(() => String)
  viewId: string;

  @Field(() => String)
  fieldMetadataId: string;

  @Field(() => Int)
  size: number;
}

@ObjectType('EnsoViewerScope')
export class EnsoViewerScopeDTO {
  // True when this viewer only sees the records they own.
  @Field(() => Boolean)
  isRecordScoped: boolean;

  // Objects to leave out of this viewer's sidebar. Empty for anyone who is not
  // record-scoped. Served from the server so the list has one home.
  @Field(() => [String])
  hiddenNavigationObjectNameSingulars: string[];

  // The view this viewer should land on per object, ahead of the workspace
  // INDEX view. Empty when their role has no defaults configured.
  @Field(() => [EnsoDefaultViewDTO])
  defaultViews: EnsoDefaultViewDTO[];

  // Version stamp for the defaults above, so the client can apply a new default
  // once to someone who already has a last-visited view. Null when their role
  // has no defaults configured.
  @Field(() => String, { nullable: true })
  defaultViewsVersion: string | null;

  // This viewer's OWN defaults, which out-rank the role's. No version stamp:
  // a role default is inherited and has to reach people once, whereas this was
  // chosen deliberately, so it simply keeps winning until they change it.
  @Field(() => [EnsoDefaultViewDTO])
  personalDefaultViews: EnsoDefaultViewDTO[];

  // Column widths this viewer has dragged for themselves, across every view.
  // The view's own sizes stay the baseline: an entry here only overrides the
  // one column it names.
  @Field(() => [EnsoColumnWidthDTO])
  personalColumnWidths: EnsoColumnWidthDTO[];
}

@InputType('EnsoDefaultViewInput')
export class EnsoDefaultViewInput {
  @Field(() => String)
  objectMetadataId: string;

  @Field(() => String)
  viewId: string;
}
