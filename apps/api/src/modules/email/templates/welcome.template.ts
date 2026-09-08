import { EmailBrand, RenderedEmail, renderLayout } from './layout';

export interface WelcomeEmailInput {
  name: string | null;
  brand: EmailBrand;
  docsUrl: string;
}

/**
 * Sent after verification succeeds, not at signup — see
 * verification.template.ts for why.
 *
 * One CTA, and it is the dashboard rather than a marketing page: the
 * person just proved their address to get in, so getting in is the thing
 * they are trying to do.
 */
export function renderWelcomeEmail(input: WelcomeEmailInput): RenderedEmail {
  const greeting = input.name ? `Hi ${input.name},` : 'Hi,';

  const { html, text } = renderLayout({
    heading: 'Your Raven account is ready',
    preheader: 'Your email is confirmed — create a project and mint your first API key.',
    paragraphs: [
      greeting,
      'Your email address is confirmed and your Raven account is active.',
      'Next: create a project, mint an API key, and mint a token from your own backend. Video, voice, chat and data run on Raven’s infrastructure — you keep building your product.',
    ],
    cta: { label: 'Open the dashboard', url: `${input.brand.appUrl}/dashboard` },
    ctaFootnote: `Documentation, quickstarts and SDK references: ${input.docsUrl}`,
    brand: input.brand,
  });

  return { subject: 'Welcome to Raven', html, text };
}
