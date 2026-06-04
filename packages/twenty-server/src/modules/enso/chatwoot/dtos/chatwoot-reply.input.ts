import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class ChatwootReplyInput {
  @IsUUID()
  opportunityId: string;

  @IsString()
  @IsNotEmpty()
  conversationId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20_000)
  content: string;
}
