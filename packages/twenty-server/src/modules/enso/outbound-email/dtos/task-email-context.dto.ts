import { Field, ObjectType } from '@nestjs/graphql';

// What the email compose modal needs to render: the resolved sender (the
// manager's connected-account handle, or null), whether the email may be sent
// (TECHNICAL validity only — recipient email present + a usable connected
// account), why not, and the ADVISORY consent state. Unlike SMS, consent never
// blocks: `hasEmailConsent`/`consentNote` inform the manager but the send stays
// enabled when `canSend` is true.
@ObjectType()
export class TaskEmailContext {
  @Field(() => String, { nullable: true })
  from?: string | null;

  @Field(() => Boolean)
  canSend: boolean;

  @Field(() => String, { nullable: true })
  reason?: string | null;

  @Field(() => Boolean)
  hasEmailConsent: boolean;

  @Field(() => String, { nullable: true })
  consentNote?: string | null;
}
