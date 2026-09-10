import { EmailBrand, RenderedEmail, renderLayout } from './layout';

export interface PasswordChangedEmailInput {
  name: string | null;
  brand: EmailBrand;
}

/**
 * A security notification, and the only email here sent for something
 * that already happened rather than something the recipient must do.
 *
 * It exists because a successful reset is exactly the event a victim needs
 * to hear about: if the person reading this did not perform it, their
 * account has just been taken over, and the seconds between the change and
 * them noticing are the whole window. It carries no link with authority —
 * only a plain sign-in URL and a support address, so it cannot itself be
 * repurposed as a phishing lure.
 */
export function renderPasswordChangedEmail(input: PasswordChangedEmailInput): RenderedEmail {
  const greeting = input.name ? `Hi ${input.name},` : 'Hi,';

  const { html, text } = renderLayout({
    heading: 'Your Livqeno password was changed',
    preheader: 'The password on your Livqeno account was just changed.',
    paragraphs: [
      greeting,
      'The password for your Livqeno account was changed just now. If that was you, there is nothing to do.',
      'If it was not you, someone else has access to this account. Reset the password immediately and contact support.',
    ],
    cta: { label: 'Sign in to Livqeno', url: `${input.brand.appUrl}/login` },
    closing: `Support: ${input.brand.supportEmail}`,
    brand: input.brand,
  });

  return { subject: 'Your Livqeno password was changed', html, text };
}
