import { Field, ObjectType } from '@nestjs/graphql';

// The read-only profile behind a lookup match.
//
// A scoped manager cannot open somebody else's record, and should not be able
// to: the record page carries the contact details, the conversation and the
// notes. What they legitimately need is the decision material — who owns this,
// since when, how warm is it, where did it come from — so that is what this
// returns, and nothing here can be edited, because none of it is a record.
@ObjectType('EnsoLeadProfileProject')
export class EnsoLeadProfileProjectDTO {
  @Field(() => String, { nullable: true })
  projectId: string | null;

  @Field(() => String, { nullable: true })
  projectName: string | null;

  @Field(() => String, { nullable: true })
  projectCode: string | null;

  @Field(() => String, { nullable: true })
  ownerName: string | null;

  // The owner's work address, so "go and ask the colleague who has it" is one
  // click instead of a hunt. Internal contact detail, not the lead's.
  @Field(() => String, { nullable: true })
  ownerEmail: string | null;

  @Field(() => String, { nullable: true })
  ownerWorkspaceMemberId: string | null;

  @Field(() => Boolean)
  isMine: boolean;

  @Field(() => Date, { nullable: true })
  firstContactAt: Date | null;

  @Field(() => Date, { nullable: true })
  lastTouchAt: Date | null;

  // A constructed label ("Call deal"), never the stored deal name, which
  // carries the contact's phone number.
  @Field(() => String, { nullable: true })
  dealLabel: string | null;

  // The raw stage key (CONNECTED, DEEP_QUALIFICATION, …). How far along a
  // colleague is decides whether you leave the lead alone, and it says nothing
  // about how to reach the contact.
  @Field(() => String, { nullable: true })
  dealStage: string | null;

  // OPEN | WON | LOST | NONE
  @Field(() => String)
  dealStatus: string;

  @Field(() => String, { nullable: true })
  dealSource: string | null;

  @Field(() => String, { nullable: true })
  trafficType: string | null;

  @Field(() => String, { nullable: true })
  utmSource: string | null;

  @Field(() => String, { nullable: true })
  utmCampaign: string | null;

  @Field(() => Number)
  reengagementCount: number;
}

// Counts and dates only — never a subject line, a message body or a recording.
@ObjectType('EnsoLeadProfileActivity')
export class EnsoLeadProfileActivityDTO {
  @Field(() => Number)
  inboundCount: number;

  @Field(() => Number)
  outboundCount: number;

  @Field(() => Date, { nullable: true })
  lastInboundAt: Date | null;

  @Field(() => Date, { nullable: true })
  lastOutboundAt: Date | null;
}

@ObjectType('EnsoLeadProfile')
export class EnsoLeadProfileDTO {
  // False when the subject does not exist, or exists but has been deleted. The
  // UI says so rather than rendering an empty profile.
  @Field(() => Boolean)
  isFound: boolean;

  // False for admins and anyone else who already sees every record: they open
  // the real record instead, so the profile refuses to answer.
  @Field(() => Boolean)
  isViewerScoped: boolean;

  @Field(() => String, { nullable: true })
  personId: string | null;

  @Field(() => String)
  displayName: string;

  // Masked exactly as in the lookup line: enough to confirm this is the person
  // in front of you, not enough to work them behind the owner's back.
  @Field(() => String, { nullable: true })
  maskedPhone: string | null;

  @Field(() => String, { nullable: true })
  maskedEmail: string | null;

  @Field(() => Date, { nullable: true })
  firstTouchAt: Date | null;

  @Field(() => Boolean)
  isMine: boolean;

  @Field(() => [EnsoLeadProfileProjectDTO])
  projects: EnsoLeadProfileProjectDTO[];

  @Field(() => EnsoLeadProfileActivityDTO)
  activity: EnsoLeadProfileActivityDTO;
}
