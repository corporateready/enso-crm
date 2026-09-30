import { isNonEmptyString } from '@sniptt/guards';

import { type EnsoTimelineSegment } from 'src/modules/enso/timeline/enso-timeline.util';

// outboundActivity.channel SELECT values a Chatwoot reply can land on.
export type ChatwootReplyOutboundChannel =
  | 'EMAIL'
  | 'SOCIAL'
  | 'WHATSAPP'
  | 'SMS';

export type ChatwootReplyOutbound = {
  channel: ChatwootReplyOutboundChannel;
  // enso timeline action → timelineActivity.name `enso-event.<action>`.
  action: 'email-sent' | 'message-sent';
  segments: EnsoTimelineSegment[];
};

const REPLY_PREFIX = /^\s*re\s*:/i;

// A manager's reply from the in-CRM chat panel, expressed as the outbound touch
// it is: Chatwoot's inbox channel ("Channel::Email", "Channel::Instagram", …)
// picks the outboundActivity channel and the timeline sentence. The inbound
// activity's platform (INSTAGRAM/FACEBOOK) wins when present because Chatwoot
// reports both Facebook pages and Instagram as page-backed channels.
export const buildChatwootReplyOutbound = (params: {
  channelType: string | null;
  platform: string | null;
  subject: string | null;
}): ChatwootReplyOutbound => {
  const channelType = (params.channelType ?? '').toLowerCase();
  const platform = (params.platform ?? '').toLowerCase();

  if (channelType.includes('email')) {
    const subject = isNonEmptyString(params.subject)
      ? params.subject.trim()
      : null;
    const replySubject = isNonEmptyString(subject)
      ? REPLY_PREFIX.test(subject)
        ? subject
        : `Re: ${subject}`
      : null;

    return {
      channel: 'EMAIL',
      action: 'email-sent',
      segments: isNonEmptyString(replySubject)
        ? [{ text: 'Replied by email · ' }, { text: replySubject }]
        : [{ text: 'Replied by email' }],
    };
  }

  if (channelType.includes('whatsapp') || platform.includes('whats')) {
    return {
      channel: 'WHATSAPP',
      action: 'message-sent',
      segments: [{ text: 'Replied on WhatsApp' }],
    };
  }

  if (channelType.includes('sms') || channelType.includes('twilio')) {
    return {
      channel: 'SMS',
      action: 'message-sent',
      segments: [{ text: 'Replied by SMS' }],
    };
  }

  const network =
    platform.includes('insta') || channelType.includes('instagram')
      ? 'Instagram'
      : platform.includes('face') || channelType.includes('facebook')
        ? 'Facebook'
        : platform.includes('tele') || channelType.includes('telegram')
          ? 'Telegram'
          : null;

  return {
    channel: 'SOCIAL',
    action: 'message-sent',
    segments: [
      {
        text: isNonEmptyString(network)
          ? `Replied on ${network}`
          : 'Replied to a message',
      },
    ],
  };
};
