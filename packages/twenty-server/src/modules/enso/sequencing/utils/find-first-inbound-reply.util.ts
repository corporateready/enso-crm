import { isDefined } from 'twenty-shared/utils';

import { INBOUND_REPLY_KIND_TO_FIRST_CONTACT_CHANNEL } from 'src/modules/enso/sequencing/sequencing.constants';

type InboundActivityForReply = {
  kind?: string | null;
  occurredAt?: string | Date | null;
  createdAt?: string | Date | null;
};

export type InboundReply = {
  channel: string;
  occurredAtMs: number;
};

// The earliest social message or email that landed after enrollment. The
// pre-claim first message predates enrollment, so it never counts as a reply.
// Earliest wins so firstContactChannel names the channel the lead answered on first.
export const findFirstInboundReply = (
  activities: InboundActivityForReply[],
  enrolledAtMs: number,
): InboundReply | undefined =>
  activities
    .map((activity) => {
      const channel = isDefined(activity.kind)
        ? INBOUND_REPLY_KIND_TO_FIRST_CONTACT_CHANNEL[activity.kind]
        : undefined;
      const occurredAt = activity.occurredAt ?? activity.createdAt;

      return {
        channel,
        occurredAtMs: isDefined(occurredAt)
          ? new Date(occurredAt).getTime()
          : undefined,
      };
    })
    .filter(
      (reply): reply is InboundReply =>
        isDefined(reply.channel) &&
        isDefined(reply.occurredAtMs) &&
        reply.occurredAtMs > enrolledAtMs,
    )
    .sort((left, right) => left.occurredAtMs - right.occurredAtMs)[0];
