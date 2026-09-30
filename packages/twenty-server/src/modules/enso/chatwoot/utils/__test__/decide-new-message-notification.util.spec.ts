import { type ChatwootMessage } from 'src/modules/enso/chatwoot/services/chatwoot-client.service';
import { decideNewMessageNotification } from 'src/modules/enso/chatwoot/utils/decide-new-message-notification.util';

const NOW = new Date('2026-10-01T12:00:00.000Z').getTime();
const minutesAgo = (minutes: number) =>
  new Date(NOW - minutes * 60 * 1000).toISOString();
const message = (
  id: number,
  incoming: boolean,
  createdAt: string,
  isPrivate = false,
): ChatwootMessage => ({
  id,
  content: `message ${id}`,
  incoming,
  isPrivate,
  senderName: null,
  createdAt,
  attachments: [],
});

describe('decideNewMessageNotification', () => {
  it('should notify on the lead reply that follows the manager reply', () => {
    const decision = decideNewMessageNotification({
      messages: [
        message(1, true, minutesAgo(120)),
        message(2, false, minutesAgo(60)),
        message(3, true, minutesAgo(1)),
      ],
      messageId: 3,
      nowMs: NOW,
    });

    expect(decision.notify).toBe(true);
  });

  it('should not notify again while the lead keeps writing', () => {
    expect(
      decideNewMessageNotification({
        messages: [
          message(2, false, minutesAgo(60)),
          message(3, true, minutesAgo(2)),
          message(4, true, minutesAgo(1)),
        ],
        messageId: 4,
        nowMs: NOW,
      }),
    ).toEqual({
      notify: false,
      reason: 'lead is still writing (already notified for this burst)',
    });
  });

  it('should ignore private notes when finding the previous message', () => {
    const decision = decideNewMessageNotification({
      messages: [
        message(2, false, minutesAgo(60)),
        message(3, false, minutesAgo(30), true),
        message(4, true, minutesAgo(1)),
      ],
      messageId: 4,
      nowMs: NOW,
    });

    expect(decision.notify).toBe(true);
  });

  it('should leave the first message of a conversation to the assignment notice', () => {
    expect(
      decideNewMessageNotification({
        messages: [message(1, true, minutesAgo(1))],
        messageId: 1,
        nowMs: NOW,
      }).notify,
    ).toBe(false);
  });

  it('should skip manager replies', () => {
    expect(
      decideNewMessageNotification({
        messages: [
          message(1, true, minutesAgo(5)),
          message(2, false, minutesAgo(1)),
        ],
        messageId: 2,
        nowMs: NOW,
      }),
    ).toEqual({ notify: false, reason: 'not a message from the lead' });
  });

  it('should leave a reply after 24h of silence to the re-engagement notice', () => {
    expect(
      decideNewMessageNotification({
        messages: [
          message(2, false, minutesAgo(25 * 60)),
          message(3, true, minutesAgo(1)),
        ],
        messageId: 3,
        nowMs: NOW,
      }).notify,
    ).toBe(false);
  });

  it('should never notify an old message, so replays cannot page a manager', () => {
    expect(
      decideNewMessageNotification({
        messages: [
          message(2, false, minutesAgo(120)),
          message(3, true, minutesAgo(30)),
        ],
        messageId: 3,
        nowMs: NOW,
      }),
    ).toEqual({ notify: false, reason: 'message is not recent' });
  });

  it('should not notify a message id that is not in the conversation', () => {
    expect(
      decideNewMessageNotification({
        messages: [message(1, true, minutesAgo(1))],
        messageId: 99,
        nowMs: NOW,
      }).notify,
    ).toBe(false);
  });
});
