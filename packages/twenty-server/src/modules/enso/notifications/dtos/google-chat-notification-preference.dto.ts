import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class GoogleChatNotificationPreference {
  @Field(() => String)
  event: string;

  @Field(() => Boolean)
  enabled: boolean;
}
