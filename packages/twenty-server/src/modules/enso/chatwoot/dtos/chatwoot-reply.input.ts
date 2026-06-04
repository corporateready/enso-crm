import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

// Sent as multipart/form-data (so attachments can ride along); text fields
// arrive as strings. Content is optional when there are attachments.
export class ChatwootReplyInput {
  @IsIn(['opportunity', 'person'])
  recordType: 'opportunity' | 'person';

  @IsUUID()
  recordId: string;

  @IsString()
  @IsNotEmpty()
  conversationId: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  content?: string;
}
