import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class GoogleChatTestResult {
  @Field(() => Boolean)
  success: boolean;

  @Field(() => String, { nullable: true })
  error?: string;
}
