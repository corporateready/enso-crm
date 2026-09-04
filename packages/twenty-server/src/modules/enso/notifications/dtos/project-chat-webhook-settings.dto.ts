import { Field, ObjectType } from '@nestjs/graphql';

// One row per project, so the settings UI can list every development and show
// which ones already have a marketing space wired up.
@ObjectType()
export class ProjectChatWebhookSettings {
  @Field(() => String)
  projectId: string;

  @Field(() => String, { nullable: true })
  projectName?: string;

  @Field(() => String, { nullable: true })
  projectCode?: string;

  @Field(() => Boolean)
  isConfigured: boolean;

  // Masked (never the real URL) — present only when configured.
  @Field(() => String, { nullable: true })
  maskedWebhookUrl?: string;
}
