import { buildChatwootReplyOutbound } from 'src/modules/enso/chatwoot/utils/build-chatwoot-reply-outbound.util';

describe('buildChatwootReplyOutbound', () => {
  it('should log an email reply with a Re: subject on the EMAIL channel', () => {
    expect(
      buildChatwootReplyOutbound({
        channelType: 'Channel::Email',
        platform: null,
        subject: 'Aici prezentarea promisă',
      }),
    ).toEqual({
      channel: 'EMAIL',
      action: 'email-sent',
      segments: [
        { text: 'Replied by email · ' },
        { text: 'Re: Aici prezentarea promisă' },
      ],
    });
  });

  it('should not double the Re: prefix when the thread subject already has one', () => {
    expect(
      buildChatwootReplyOutbound({
        channelType: 'Channel::Email',
        platform: null,
        subject: 'RE: Oferta',
      }).segments,
    ).toEqual([{ text: 'Replied by email · ' }, { text: 'RE: Oferta' }]);
  });

  it('should fall back to a plain sentence when the email has no subject', () => {
    expect(
      buildChatwootReplyOutbound({
        channelType: 'Channel::Email',
        platform: null,
        subject: '  ',
      }).segments,
    ).toEqual([{ text: 'Replied by email' }]);
  });

  it('should name Instagram from the inbound platform even on a page-backed channel', () => {
    expect(
      buildChatwootReplyOutbound({
        channelType: 'Channel::FacebookPage',
        platform: 'INSTAGRAM',
        subject: null,
      }),
    ).toEqual({
      channel: 'SOCIAL',
      action: 'message-sent',
      segments: [{ text: 'Replied on Instagram' }],
    });
  });

  it('should log Facebook Messenger replies as SOCIAL', () => {
    expect(
      buildChatwootReplyOutbound({
        channelType: 'Channel::FacebookPage',
        platform: 'FACEBOOK',
        subject: null,
      }).segments,
    ).toEqual([{ text: 'Replied on Facebook' }]);
  });

  it('should map WhatsApp to its own outbound channel', () => {
    expect(
      buildChatwootReplyOutbound({
        channelType: 'Channel::Whatsapp',
        platform: null,
        subject: null,
      }).channel,
    ).toBe('WHATSAPP');
  });

  it('should still log an unknown channel as a social reply', () => {
    expect(
      buildChatwootReplyOutbound({
        channelType: null,
        platform: null,
        subject: null,
      }),
    ).toEqual({
      channel: 'SOCIAL',
      action: 'message-sent',
      segments: [{ text: 'Replied to a message' }],
    });
  });
});
