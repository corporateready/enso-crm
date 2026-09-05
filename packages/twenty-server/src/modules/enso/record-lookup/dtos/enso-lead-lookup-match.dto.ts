import { Field, ObjectType } from '@nestjs/graphql';

// One project a matched contact is attached to. This is the whole point of the
// lookup: enough to know who is already working this lead and since when, and
// nothing that would let you work it yourself.
@ObjectType('EnsoLeadLookupProject')
export class EnsoLeadLookupProjectDTO {
  @Field(() => String, { nullable: true })
  projectId: string | null;

  @Field(() => String, { nullable: true })
  projectName: string | null;

  @Field(() => String, { nullable: true })
  projectCode: string | null;

  @Field(() => String, { nullable: true })
  ownerName: string | null;

  @Field(() => String, { nullable: true })
  ownerWorkspaceMemberId: string | null;

  // True when the viewer is the owner, so the UI can say "this is yours"
  // instead of pointing them at a colleague.
  @Field(() => Boolean)
  isMine: boolean;

  @Field(() => Date, { nullable: true })
  firstContactAt: Date | null;

  @Field(() => Date, { nullable: true })
  lastTouchAt: Date | null;

  // OPEN | WON | LOST | NONE — the bucket only, never the stage, the amount or
  // the lost reason.
  @Field(() => String)
  dealStatus: string;
}

@ObjectType('EnsoLeadLookupMatch')
export class EnsoLeadLookupMatchDTO {
  @Field(() => String)
  personId: string;

  @Field(() => String)
  displayName: string;

  // PHONE | EMAIL | NAME
  @Field(() => String)
  matchedOn: string;

  // Enough to confirm it is the same person, not enough to contact them.
  @Field(() => String, { nullable: true })
  maskedPhone: string | null;

  @Field(() => String, { nullable: true })
  maskedEmail: string | null;

  @Field(() => Date, { nullable: true })
  firstTouchAt: Date | null;

  @Field(() => Boolean)
  isMine: boolean;

  @Field(() => [EnsoLeadLookupProjectDTO])
  projects: EnsoLeadLookupProjectDTO[];
}

@ObjectType('EnsoLeadLookupResult')
export class EnsoLeadLookupResultDTO {
  @Field(() => [EnsoLeadLookupMatchDTO])
  matches: EnsoLeadLookupMatchDTO[];

  // Set when the daily allowance is spent, so the UI can explain the empty
  // result instead of implying the contact does not exist.
  @Field(() => Boolean)
  isRateLimited: boolean;

  @Field(() => Number)
  remainingLookupsToday: number;
}
