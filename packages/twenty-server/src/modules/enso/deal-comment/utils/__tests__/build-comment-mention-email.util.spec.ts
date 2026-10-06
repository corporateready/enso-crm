import { buildCommentMentionEmail } from 'src/modules/enso/deal-comment/utils/build-comment-mention-email.util';

describe('buildCommentMentionEmail', () => {
  it('should name the author and the deal in the subject', () => {
    expect(
      buildCommentMentionEmail({
        authorName: 'Ana Popescu',
        body: 'Is unit 12 free?',
        dealName: 'Deal | Groveo',
      }).subject,
    ).toBe('Ana Popescu mentioned you on Deal | Groveo');
  });

  it('should carry the comment, the details and the link in the text', () => {
    const { text } = buildCommentMentionEmail({
      authorName: 'Ana Popescu',
      body: 'Is unit 12 free?',
      dealName: 'Deal | Groveo',
      projectName: 'ARTIMA',
      recordUrl: 'https://crm.enso.ro/object/opportunity/opp-1',
    });

    expect(text).toContain('Is unit 12 free?');
    expect(text).toContain('Project: ARTIMA');
    expect(text).not.toContain('Contact:');
    expect(text).toContain(
      'Open the deal: https://crm.enso.ro/object/opportunity/opp-1',
    );
  });

  it('should escape the comment before putting it in the HTML', () => {
    const { html } = buildCommentMentionEmail({
      authorName: 'Ana',
      body: '<script>alert(1)</script> & co',
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
  });
});
