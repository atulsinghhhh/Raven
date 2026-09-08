/**
 * One layout, five emails.
 *
 * Constraints that shaped it, all of them properties of email clients
 * rather than preferences:
 *
 * - **Tables and inline styles.** Outlook's rendering engine is Word's.
 *   A flexbox layout with a `<style>` block is a single column of
 *   unstyled text there.
 * - **No images at all.** Gmail and Outlook block remote images by
 *   default and inline SVG is stripped outright, so a logo would be an
 *   empty box for most recipients on the first read. The wordmark is
 *   text, styled — it renders everywhere, including in the plain-text
 *   part.
 * - **No dependency on the dashboard's design system.** apps/dashboard's
 *   CSS is Tailwind v4 tokens in oklch(); email clients understand
 *   neither. The one thing shared is the accent hex, copied deliberately
 *   (globals.css `--accent`) rather than imported — the API must not
 *   depend on a browser app to send a password reset.
 *
 * Every caller passes plain strings. Escaping happens here, once, so no
 * template can forget it.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Deployment-specific values every template needs in its footer. */
export interface EmailBrand {
  /** Dashboard origin — where links go. Never this API's URL. */
  appUrl: string;
  supportEmail: string;
}

export interface LayoutInput {
  /** Shown as the H1. */
  heading: string;
  /**
   * The grey line most clients show next to the subject in the list view.
   * Left out, clients improvise one from the first words of the body,
   * which is how "View this email in your browser" became a genre.
   */
  preheader: string;
  /** Body copy, one entry per paragraph. Escaped here. */
  paragraphs: string[];
  cta?: { label: string; url: string };
  /**
   * Printed under the button. Every CTA email needs one: a button is not
   * clickable in every client, and a link that cannot be copied is a
   * dead end.
   */
  ctaFootnote?: string;
  /** Last line before the footer — expiry, or what to do if this wasn't you. */
  closing?: string;
  brand: EmailBrand;
}

const ACCENT = '#e2672f';
const FG = '#1c1917';
const MUTED = '#57534e';
const SUBTLE = '#a8a29e';
const BORDER = '#e7e5e4';
const CANVAS = '#f5f4f2';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * URLs are escaped as HTML but never re-encoded as URLs: they arrive
 * already built (`new URL(...).toString()`), and encoding them twice is
 * how a token acquires a stray %25 and stops matching.
 */
function attr(url: string): string {
  return escapeHtml(url);
}

export function renderLayout(input: LayoutInput): { html: string; text: string } {
  const { brand } = input;

  const paragraphsHtml = input.paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:${MUTED};">${escapeHtml(paragraph)}</p>`,
    )
    .join('\n              ');

  const ctaHtml = input.cta
    ? `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
                <tr>
                  <td align="center" bgcolor="${ACCENT}" style="border-radius:8px;">
                    <a href="${attr(input.cta.url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#fff7ee;text-decoration:none;border-radius:8px;">${escapeHtml(input.cta.label)}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:13px;line-height:20px;color:${SUBTLE};">Or paste this link into your browser:</p>
              <p style="margin:0 0 16px;font-size:13px;line-height:20px;word-break:break-all;"><a href="${attr(input.cta.url)}" style="color:${ACCENT};">${escapeHtml(input.cta.url)}</a></p>`
    : '';

  const ctaFootnoteHtml = input.ctaFootnote
    ? `<p style="margin:0 0 16px;font-size:13px;line-height:20px;color:${SUBTLE};">${escapeHtml(input.ctaFootnote)}</p>`
    : '';

  const closingHtml = input.closing
    ? `<p style="margin:24px 0 0;font-size:13px;line-height:20px;color:${SUBTLE};">${escapeHtml(input.closing)}</p>`
    : '';

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${escapeHtml(input.heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:${CANVAS};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">${escapeHtml(input.preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CANVAS};padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border:1px solid ${BORDER};border-radius:12px;">
            <tr>
              <td style="padding:28px 28px 0;">
                <a href="${attr(brand.appUrl)}" style="text-decoration:none;color:${FG};font-size:16px;font-weight:700;letter-spacing:-0.01em;">
                  <span style="color:${ACCENT};">&#9679;</span>&nbsp;Raven
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px 28px;">
                <h1 style="margin:0 0 16px;font-size:20px;line-height:28px;font-weight:600;color:${FG};">${escapeHtml(input.heading)}</h1>
              ${paragraphsHtml}${ctaHtml}
              ${ctaFootnoteHtml}${closingHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 28px;">
                <hr style="border:none;border-top:1px solid ${BORDER};margin:0 0 16px;" />
                <p style="margin:0;font-size:12px;line-height:18px;color:${SUBTLE};">
                  Raven &mdash; real-time communication infrastructure.<br />
                  Questions? <a href="mailto:${attr(brand.supportEmail)}" style="color:${MUTED};">${escapeHtml(brand.supportEmail)}</a><br />
                  This is a transactional message about your Raven account, not marketing.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  // The plain-text part is a real alternative, not a stripped-tags
  // afterthought: it is what a screen reader, a text-only client, and
  // most spam filters read.
  const textParts = [
    'Raven',
    '',
    input.heading,
    '',
    ...input.paragraphs.flatMap((paragraph) => [paragraph, '']),
  ];
  if (input.cta) {
    textParts.push(`${input.cta.label}: ${input.cta.url}`, '');
  }
  if (input.ctaFootnote) {
    textParts.push(input.ctaFootnote, '');
  }
  if (input.closing) {
    textParts.push(input.closing, '');
  }
  textParts.push(
    '--',
    'Raven — real-time communication infrastructure.',
    `Questions? ${brand.supportEmail}`,
    'This is a transactional message about your Raven account, not marketing.',
  );

  return { html, text: textParts.join('\n') };
}
