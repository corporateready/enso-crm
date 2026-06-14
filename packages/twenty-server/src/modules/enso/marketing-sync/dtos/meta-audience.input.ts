// Body of POST /webhooks/enso/meta-audience — pushed by a Dittofeed Webhook node
// (consent-gated via the node's subscription group). The CRM hashes email/phone
// before sending to Meta, so raw identifiers stay server-side. At least one of
// email/phone must be present.
export type MetaAudienceInput = {
  workspaceId: string;
  userId?: string;
  email?: string;
  phone?: string;
};
