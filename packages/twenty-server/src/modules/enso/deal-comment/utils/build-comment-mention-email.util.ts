type BuildCommentMentionEmailArgs = {
  authorName: string;
  body: string;
  dealName?: string;
  projectName?: string;
  contactName?: string;
  recordUrl?: string;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// The email a tagged colleague gets when they have no personal Google Chat
// webhook. It carries the same facts as the Chat card. The comment text is
// written by a colleague, so it is escaped before it goes into the HTML.
export const buildCommentMentionEmail = ({
  authorName,
  body,
  dealName,
  projectName,
  contactName,
  recordUrl,
}: BuildCommentMentionEmailArgs): {
  subject: string;
  text: string;
  html: string;
} => {
  const details: [string, string | undefined][] = [
    ['Deal', dealName],
    ['Project', projectName],
    ['Contact', contactName],
  ];
  const presentDetails = details.filter(
    (detail): detail is [string, string] => (detail[1] ?? '') !== '',
  );

  const subject = dealName
    ? `${authorName} mentioned you on ${dealName}`
    : `${authorName} mentioned you in a deal comment`;

  const text = [
    `${authorName} mentioned you in a deal comment:`,
    '',
    body,
    '',
    ...presentDetails.map(([label, value]) => `${label}: ${value}`),
    ...(recordUrl ? ['', `Open the deal: ${recordUrl}`] : []),
  ].join('\n');

  const html = [
    `<p><strong>${escapeHtml(authorName)}</strong> mentioned you in a deal comment:</p>`,
    `<blockquote style="border-left:3px solid #ccc;margin:0;padding:4px 12px;white-space:pre-wrap">${escapeHtml(body)}</blockquote>`,
    presentDetails.length > 0
      ? `<p>${presentDetails
          .map(([label, value]) => `${escapeHtml(label)}: ${escapeHtml(value)}`)
          .join('<br>')}</p>`
      : '',
    recordUrl
      ? `<p><a href="${escapeHtml(recordUrl)}">Open the deal</a></p>`
      : '',
  ].join('');

  return { subject, text, html };
};
