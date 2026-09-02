import { Field, ObjectType } from '@nestjs/graphql';

// Result of a manager pressing "Call via PBX". `activityId` is the row the PBX
// placed the call against — the widget stamps the outcome onto it rather than
// creating a second activity for the same call.
@ObjectType()
export class CallViaPbxResult {
  @Field(() => Boolean)
  success: boolean;

  @Field(() => String, { nullable: true })
  error?: string | null;

  @Field(() => String, { nullable: true })
  activityId?: string | null;
}
