import { Field, ObjectType } from '@nestjs/graphql';

// What the object/launcher SMS composer needs: the sender aliases this contact
// may be reached under (the brands of the projects they consented to), whether
// an SMS may be sent at all, and why not.
@ObjectType()
export class PersonSmsContext {
  @Field(() => [String])
  aliases: string[];

  @Field(() => Boolean)
  canSend: boolean;

  @Field(() => String, { nullable: true })
  reason?: string | null;
}
