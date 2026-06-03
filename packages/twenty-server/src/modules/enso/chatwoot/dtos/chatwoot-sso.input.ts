import { IsUUID } from 'class-validator';

export class ChatwootSsoInput {
  @IsUUID()
  opportunityId: string;
}
