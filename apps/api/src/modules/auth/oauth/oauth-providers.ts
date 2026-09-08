import { AuthProvider } from '../../../generated/prisma/client';

/**
 * What Raven needs to know about a person after the provider has vouched
 * for them. Everything else the provider returns — access tokens, avatar
 * URLs, follower counts — is dropped on the floor here, on purpose: the
 * exchange proves identity and nothing is persisted beyond the link.
 */
export interface OAuthProfile {
  /** The provider's stable id (GitHub numeric id, Google `sub`) as a string. */
  providerAccountId: string;
  email: string | null;
  /**
   * Whether the *provider* has verified that email. Gates account linking:
   * an unverified provider email must never attach to an existing Raven
   * account, or anyone could claim an address at the provider and take
   * over the Raven account that owns it.
   */
  emailVerified: boolean;
  name: string | null;
}

export interface OAuthProviderConfig {
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  callbackUrl: string;
}

export const OAUTH_PROVIDER_PARAM: Record<string, AuthProvider> = {
  github: AuthProvider.GITHUB,
  google: AuthProvider.GOOGLE,
};

/** Lowercase wire name for a provider, e.g. for config lookups and URLs. */
export function providerSlug(provider: AuthProvider): 'github' | 'google' {
  return provider === AuthProvider.GITHUB ? 'github' : 'google';
}

export function providerLabel(provider: AuthProvider): string {
  return provider === AuthProvider.GITHUB ? 'GitHub' : 'Google';
}

// Provider endpoints. Constants rather than config: these are protocol
// facts, not deployment choices, and a value here changing means the
// provider changed their API — a code change either way.
export const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const GITHUB_USER_URL = 'https://api.github.com/user';
export const GITHUB_EMAILS_URL = 'https://api.github.com/user/emails';

export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
