import { findFirstInboundReply } from 'src/modules/enso/sequencing/utils/find-first-inbound-reply.util';

const ENROLLED_AT = '2026-09-30T10:00:00.000Z';
const enrolledAtMs = new Date(ENROLLED_AT).getTime();

describe('findFirstInboundReply', () => {
  it('should treat an email reply after enrollment as a reply on the EMAIL channel', () => {
    expect(
      findFirstInboundReply(
        [{ kind: 'EMAIL_MESSAGE', occurredAt: '2026-09-30T12:00:00.000Z' }],
        enrolledAtMs,
      ),
    ).toEqual({
      channel: 'EMAIL',
      occurredAtMs: new Date('2026-09-30T12:00:00.000Z').getTime(),
    });
  });

  it('should keep treating a social message after enrollment as a SOCIAL reply', () => {
    expect(
      findFirstInboundReply(
        [{ kind: 'SOCIAL_MESSAGE', occurredAt: '2026-09-30T11:00:00.000Z' }],
        enrolledAtMs,
      )?.channel,
    ).toBe('SOCIAL');
  });

  it('should ignore the pre-claim message that predates enrollment', () => {
    expect(
      findFirstInboundReply(
        [{ kind: 'SOCIAL_MESSAGE', occurredAt: '2026-09-30T09:00:00.000Z' }],
        enrolledAtMs,
      ),
    ).toBeUndefined();
  });

  it('should ignore kinds that are not replies, such as calls and forms', () => {
    expect(
      findFirstInboundReply(
        [
          { kind: 'INCOMING_CALL', occurredAt: '2026-09-30T11:00:00.000Z' },
          { kind: 'FORM_SUBMISSION', occurredAt: '2026-09-30T11:30:00.000Z' },
        ],
        enrolledAtMs,
      ),
    ).toBeUndefined();
  });

  it('should pick the earliest reply when the lead answered on several channels', () => {
    expect(
      findFirstInboundReply(
        [
          { kind: 'SOCIAL_MESSAGE', occurredAt: '2026-09-30T15:00:00.000Z' },
          { kind: 'EMAIL_MESSAGE', occurredAt: '2026-09-30T11:00:00.000Z' },
        ],
        enrolledAtMs,
      )?.channel,
    ).toBe('EMAIL');
  });

  it('should fall back to createdAt when occurredAt is missing', () => {
    expect(
      findFirstInboundReply(
        [
          {
            kind: 'EMAIL_MESSAGE',
            occurredAt: null,
            createdAt: '2026-09-30T11:00:00.000Z',
          },
        ],
        enrolledAtMs,
      )?.channel,
    ).toBe('EMAIL');
  });
});
