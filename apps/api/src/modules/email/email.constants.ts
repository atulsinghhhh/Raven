import { createHash } from 'crypto';

/**
 * Every transactional email Livqeno sends. The value is what appears in
 * logs and in the `type` label on the Prometheus counters, so it is a
 * stable identifier rather than a display string — renaming one renames a
 * metric label.
 *
 * Deliberately short. Livqeno does not email a developer for every event;
 * this list is signup, the two credential flows, and being added to
 * someone else's project. Anything beyond that belongs in webhooks, which
 * already exist and are the right surface for product events.
 */
export enum EmailType {
  EmailVerification = 'email_verification',
  Welcome = 'welcome',
  PasswordReset = 'password_reset',
  PasswordChanged = 'password_changed',
  ProjectMemberAdded = 'project_member_added',
}

/**
 * Recipients are hashed before they become part of a Redis key.
 *
 * The cooldown only needs to answer "have we mailed this person recently",
 * which a digest answers exactly as well as the address does — and it
 * means a `KEYS email:*` on a shared Redis returns hashes rather than a
 * ready-made list of every developer's address.
 */
export function hashRecipient(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
}

export const EmailRedisKeys = {
  cooldown: (type: EmailType, recipientHash: string) => `email:cooldown:${type}:${recipientHash}`,
  /** `day` is UTC yyyy-mm-dd. Resend's quota day is UTC too. */
  dailyQuota: (day: string) => `email:quota:day:${day}`,
  /** `month` is UTC yyyy-mm. */
  monthlyQuota: (month: string) => `email:quota:month:${month}`,
} as const;

/** Only the domain is ever logged — see docs/email.md#logging. */
export function recipientDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? 'unknown' : email.slice(at + 1).toLowerCase();
}
