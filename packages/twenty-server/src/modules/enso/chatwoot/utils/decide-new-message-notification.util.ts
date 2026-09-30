import { isDefined } from 'twenty-shared/utils';

import { type ChatwootMessage } from 'src/modules/enso/chatwoot/services/chatwoot-client.service';

export type NewMessageDecision =
  | { notify: true; message: ChatwootMessage }
  | { notify: false; reason: string };

// A message older than this when the webhook is handled is treated as a replay
// and never notified, so a re-sent or forged event can't page a manager about
// something that happened long ago.
export const NEW_MESSAGE_MAX_AGE_MS = 15 * 60 * 1000;

// After this much silence the message is a re-engagement, which intake already
// notifies (a new Chatwoot conversation for DMs, the 24h follow-up rule for email).
export const NEW_MESSAGE_REENGAGEMENT_GAP_MS = 24 * 60 * 60 * 1000;

// Only the lead's FIRST message after the manager's last reply is worth a ping:
// the rest of a burst is visible the moment the manager opens the thread, and a
// ping per message would flood a fast back-and-forth. `messages` is Chatwoot's
// thread, oldest first, as returned by ChatwootClientService.listMessages.
export const decideNewMessageNotification = (params: {
  messages: ChatwootMessage[];
  messageId: number;
  nowMs: number;
}): NewMessageDecision => {
  const visible = params.messages.filter((message) => !message.isPrivate);
  const index = visible.findIndex((message) => message.id === params.messageId);

  if (index === -1) {
    return { notify: false, reason: 'message not found in the conversation' };
  }

  const message = visible[index];

  if (!message.incoming) {
    return { notify: false, reason: 'not a message from the lead' };
  }

  const createdAtMs = isDefined(message.createdAt)
    ? new Date(message.createdAt).getTime()
    : NaN;

  if (
    Number.isNaN(createdAtMs) ||
    params.nowMs - createdAtMs > NEW_MESSAGE_MAX_AGE_MS
  ) {
    return { notify: false, reason: 'message is not recent' };
  }

  const previous = visible[index - 1];

  if (!isDefined(previous)) {
    return {
      notify: false,
      reason: 'first message of the conversation (the assignment notifies it)',
    };
  }

  if (previous.incoming) {
    return {
      notify: false,
      reason: 'lead is still writing (already notified for this burst)',
    };
  }

  const previousAtMs = isDefined(previous.createdAt)
    ? new Date(previous.createdAt).getTime()
    : NaN;

  if (
    !Number.isNaN(previousAtMs) &&
    createdAtMs - previousAtMs >= NEW_MESSAGE_REENGAGEMENT_GAP_MS
  ) {
    return {
      notify: false,
      reason: 'quiet for 24h+ (the re-engagement notice covers it)',
    };
  }

  return { notify: true, message };
};
