import { Field, InputType } from '@nestjs/graphql';

import { IsNotEmpty, IsString } from 'class-validator';

@InputType()
export class SetGoogleChatWebhookUrlInput {
  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  webhookUrl: string;
}
