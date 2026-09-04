import { Field, InputType } from '@nestjs/graphql';

import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

@InputType()
export class SetProjectChatWebhookUrlInput {
  @Field(() => String)
  @IsUUID()
  projectId: string;

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  webhookUrl: string;
}
