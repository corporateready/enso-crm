import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType('DealCommentResult')
export class DealCommentResult {
  @Field(() => Boolean)
  success: boolean;

  @Field(() => String, { nullable: true })
  error?: string;

  @Field(() => String, { nullable: true })
  commentId?: string;
}
