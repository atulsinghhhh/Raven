import { formatDuration } from './duration';
import { EmailBrand, RenderedEmail, renderLayout } from './layout';

export interface VerificationEmailInput {
  name: string | null;
  verifyUrl: string;
  expiresInMinutes: number;
  brand: EmailBrand;
}

/**
 * Sent once, at signup. The welcome email deliberately does *not* go out
 * alongside it — two emails per registration is two-thirds of a day's
 * free-tier quota for every 33 signups, and the second one has nothing to
 * say that this one does not. Welcome arrives after the address is proven,
 * which is also the first moment we know it can be delivered at all.
 */
export function renderVerificationEmail(input: VerificationEmailInput): RenderedEmail {
  const greeting = input.name ? `Hi ${input.name},` : 'Hi,';
  const expiry = formatDuration(input.expiresInMinutes);

  const { html, text } = renderLayout({
    heading: 'Confirm your email address',
    preheader: `Confirm your email to finish setting up Livqeno — the link is valid for ${expiry}.`,
    paragraphs: [
      greeting,
      'Confirm this address to finish setting up your Livqeno account. Until you do, you can sign in, but some features stay locked.',
    ],
    cta: { label: 'Confirm email address', url: input.verifyUrl },
    ctaFootnote: `This link expires in ${expiry} and can be used once.`,
    closing:
      'If you did not create a Livqeno account, ignore this email — nothing was activated, and the link expires on its own.',
    brand: input.brand,
  });

  return { subject: 'Confirm your Livqeno email address', html, text };
}
