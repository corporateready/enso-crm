import { IsIn, IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class ChatwootStatusInput {
  @IsUUID()
  opportunityId: string;

  @IsString()
  @IsNotEmpty()
  conversationId: string;

  @IsIn(['open', 'resolved', 'pending'])
  status: 'open' | 'resolved' | 'pending';
}
