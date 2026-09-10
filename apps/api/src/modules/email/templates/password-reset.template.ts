import { formatDuration } from './duration';
import { EmailBrand, RenderedEmail, renderLayout } from './layout';

export interface PasswordResetEmailInput {
  name: string | null;
  resetUrl: string;
  expiresInMinutes: number;
  brand: EmailBrand;
}

/**
 * The one email in this set that carries a live credential, which is why
 * the expiry is short, the copy says so twice, and the "wasn't me" line is
 * not optional — an unexpected reset email is the first signal a person
 * gets that someone is trying their address.
 *
 * It never contains the password, old or new. It cannot: Livqeno only ever
 * stores a bcrypt hash.
 */
export function renderPasswordResetEmail(input: PasswordResetEmailInput): RenderedEmail {
  const greeting = input.name ? `Hi ${input.name},` : 'Hi,';
  const expiry = formatDuration(input.expiresInMinutes);

  const { html, text } = renderLayout({
    heading: 'Reset your Livqeno password',
    preheader: `Choose a new password — this link is valid for ${expiry}.`,
    paragraphs: [
      greeting,
      'Someone asked to reset the password for the Livqeno account registered to this address. Choose a new one using the link below.',
    ],
    cta: { label: 'Choose a new password', url: input.resetUrl },
    ctaFootnote: `This link expires in ${expiry} and can be used once.`,
    closing:
      'If you did not request this, no action is needed — your current password still works and this link expires on its own. If you get these repeatedly, contact support.',
    brand: input.brand,
  });

  return { subject: 'Reset your Livqeno password', html, text };
}
