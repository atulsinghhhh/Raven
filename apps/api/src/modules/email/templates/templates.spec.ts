import { EmailBrand, escapeHtml, formatDuration } from './index';
import { renderPasswordChangedEmail } from './password-changed.template';
import { renderPasswordResetEmail } from './password-reset.template';
import { renderProjectMemberAddedEmail } from './project-member-added.template';
import { renderVerificationEmail } from './verification.template';
import { renderWelcomeEmail } from './welcome.template';

const brand: EmailBrand = {
  appUrl: 'https://app.ravenstack.online',
  supportEmail: 'support@mail.ravenstack.online',
};

const VERIFY_URL = 'https://app.ravenstack.online/verify-email?token=abc123';
const RESET_URL = 'https://app.ravenstack.online/reset-password?token=xyz789';

describe('email templates', () => {
  const rendered = [
    ['verification', renderVerificationEmail({ name: 'Ada', verifyUrl: VERIFY_URL, expiresInMinutes: 1440, brand })],
    ['welcome', renderWelcomeEmail({ name: 'Ada', brand, docsUrl: 'https://docs.ravenstack.online' })],
    ['password reset', renderPasswordResetEmail({ name: 'Ada', resetUrl: RESET_URL, expiresInMinutes: 60, brand })],
    ['password changed', renderPasswordChangedEmail({ name: 'Ada', brand })],
    [
      'member added',
      renderProjectMemberAddedEmail({
        name: 'Ada',
        projectName: 'Aurora',
        invitedBy: 'Grace',
        role: 'DEVELOPER',
        brand,
      }),
    ],
  ] as const;

  it.each(rendered)('%s has a subject, an HTML part and a plain-text part', (_name, email) => {
    expect(email.subject.length).toBeGreaterThan(0);
    expect(email.html).toContain('<html');
    expect(email.text.length).toBeGreaterThan(0);
    // The text part must be text, not markup with the tags left in.
    expect(email.text).not.toContain('<td');
  });

  it.each(rendered)('%s carries Raven branding and a support address', (_name, email) => {
    expect(email.html).toContain('Raven');
    expect(email.html).toContain('support@mail.ravenstack.online');
    expect(email.text).toContain('support@mail.ravenstack.online');
  });

  it.each(rendered)('%s links only to the configured app origin', (_name, email) => {
    const hrefs = [...email.html.matchAll(/href="(https?:[^"]+)"/g)].map((match) => match[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    hrefs.forEach((href) => expect(href.startsWith('https://')).toBe(true));
    // Nothing points at localhost or an API host — links go to the dashboard.
    expect(email.html).not.toContain('localhost');
  });

  describe('verification', () => {
    it('puts the exact verification URL in both parts, unmangled', () => {
      const email = renderVerificationEmail({ name: null, verifyUrl: VERIFY_URL, expiresInMinutes: 1440, brand });

      expect(email.html).toContain(VERIFY_URL);
      expect(email.text).toContain(VERIFY_URL);
    });

    it('states the expiry in human units', () => {
      const email = renderVerificationEmail({ name: null, verifyUrl: VERIFY_URL, expiresInMinutes: 1440, brand });

      expect(email.text).toContain('1 day');
      expect(email.text).not.toContain('1440 minutes');
    });

    it('greets without a name when the account has none', () => {
      const email = renderVerificationEmail({ name: null, verifyUrl: VERIFY_URL, expiresInMinutes: 60, brand });

      expect(email.text).toContain('Hi,');
    });
  });

  describe('password reset', () => {
    it('carries the reset link and its expiry', () => {
      const email = renderPasswordResetEmail({ name: 'Ada', resetUrl: RESET_URL, expiresInMinutes: 60, brand });

      expect(email.text).toContain(RESET_URL);
      expect(email.text).toContain('1 hour');
    });

    it('never contains a password field or the word "your password is"', () => {
      const email = renderPasswordResetEmail({ name: 'Ada', resetUrl: RESET_URL, expiresInMinutes: 60, brand });

      expect(email.text.toLowerCase()).not.toContain('your password is');
      expect(email.html).not.toContain('<input');
    });

    it('tells a recipient who did not ask for it that they need do nothing', () => {
      const email = renderPasswordResetEmail({ name: 'Ada', resetUrl: RESET_URL, expiresInMinutes: 60, brand });

      expect(email.text).toContain('If you did not request this');
    });
  });

  describe('project member added', () => {
    it('names the project and the person who added them', () => {
      const email = renderProjectMemberAddedEmail({
        name: 'Ada',
        projectName: 'Aurora',
        invitedBy: 'grace@example.com',
        role: 'ADMIN',
        brand,
      });

      expect(email.subject).toContain('Aurora');
      expect(email.text).toContain('grace@example.com');
      expect(email.text).toContain('admin');
    });

    it('does not put an internal project id in the link', () => {
      const email = renderProjectMemberAddedEmail({
        name: null,
        projectName: 'Aurora',
        invitedBy: 'Grace',
        role: 'VIEWER',
        brand,
      });

      expect(email.html).toContain('https://app.ravenstack.online/dashboard/projects');
      expect(email.html).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
    });
  });

  describe('escaping', () => {
    it('escapes user-supplied values rather than interpolating them raw', () => {
      const email = renderProjectMemberAddedEmail({
        name: '<script>alert(1)</script>',
        projectName: 'Aurora & "co"',
        invitedBy: 'Grace',
        role: 'DEVELOPER',
        brand,
      });

      expect(email.html).not.toContain('<script>');
      expect(email.html).toContain('&lt;script&gt;');
      expect(email.html).toContain('&amp;');
    });

    it('escapeHtml covers the five characters that matter', () => {
      expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
    });
  });

  describe('formatDuration', () => {
    it.each([
      [1, '1 minute'],
      [30, '30 minutes'],
      [60, '1 hour'],
      [120, '2 hours'],
      [1440, '1 day'],
      [2880, '2 days'],
    ])('%i minutes reads as %s', (minutes, expected) => {
      expect(formatDuration(minutes)).toBe(expected);
    });
  });
});
