import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class GoogleChatWebhookSettings {
  @Field(() => Boolean)
  isConfigured: boolean;

  // Masked (never the real URL) — present only when configured.
  @Field(() => String, { nullable: true })
  maskedWebhookUrl?: string;
}
