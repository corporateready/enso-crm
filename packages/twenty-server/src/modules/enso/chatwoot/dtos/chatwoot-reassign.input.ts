import { IsInt, IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class ChatwootReassignInput {
  @IsUUID()
  opportunityId: string;

  @IsString()
  @IsNotEmpty()
  conversationId: string;

  @IsInt()
  assigneeId: number;
}
