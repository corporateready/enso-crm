import { Field, ObjectType } from '@nestjs/graphql';

// What the SMS compose modal needs to render: the sender alias determined from
// the deal's project (or null), whether the SMS may be sent, and why not.
@ObjectType()
export class TaskSmsContext {
  @Field(() => String, { nullable: true })
  alias?: string | null;

  @Field(() => Boolean)
  canSend: boolean;

  @Field(() => String, { nullable: true })
  reason?: string | null;
}
