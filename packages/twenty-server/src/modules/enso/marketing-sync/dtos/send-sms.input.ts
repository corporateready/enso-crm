// Body of POST /webhooks/enso/send-sms — pushed by a Dittofeed Webhook-channel
// node (sms.md isn't a native Dittofeed provider). workspaceId is the CRM
// workspace; userId is the CRM person UUID (for the timeline entry); `to` is the
// recipient in E.164 (Dittofeed passes {{user.phone}}); `message` is the
// rendered SMS copy (authored as Liquid in the Dittofeed template).
export type SendSmsInput = {
  workspaceId: string;
  userId?: string;
  to: string;
  message: string;
};
