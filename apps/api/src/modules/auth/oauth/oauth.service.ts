import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { AuthProvider, User } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';
import { AppError } from '../../../shared/errors/app-error';
import { RavenErrorCode } from '../../../shared/errors/error-codes';
import { RedisService } from '../../../shared/redis/redis.service';
import { EmailType } from '../../email/email.constants';
import { EmailService } from '../../email/email.service';
import { UsageAllowanceService } from '../../usage/usage-allowance.service';
import { renderWelcomeEmail } from '../../email/templates';
import { AuthResult, AuthService } from '../auth.service';
import {
  GITHUB_AUTHORIZE_URL,
  GITHUB_EMAILS_URL,
  GITHUB_TOKEN_URL,
  GITHUB_USER_URL,
  GOOGLE_AUTHORIZE_URL,
  GOOGLE_TOKEN_URL,
  OAuthProfile,
  OAuthProviderConfig,
  providerLabel,
  providerSlug,
} from './oauth-providers';

const STATE_KEY_PREFIX = 'oauth:state:';

/** Ceiling on any single call to a provider. A hung provider must surface
 *  as a retryable error, not an open request the dashboard waits on. */
const PROVIDER_TIMEOUT_MS = 10_000;

function oauthError(message: string): AppError {
  return new AppError(message, HttpStatus.UNAUTHORIZED, RavenErrorCode.OAUTH_ERROR);
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly authService: AuthService,
    private readonly emailService: EmailService,
    private readonly usageAllowances: UsageAllowanceService,
  ) {}

  /** Which providers this deployment has configured. Safe to expose: it's
   *  exactly the set of buttons the login page should render. */
  enabledProviders(): { github: boolean; google: boolean } {
    return {
      github: this.providerConfig(AuthProvider.GITHUB).enabled,
      google: this.providerConfig(AuthProvider.GOOGLE).enabled,
    };
  }

  /**
   * Begins the authorization dance: mints a single-use `state`, remembers
   * it in Redis for one round-trip, and hands back the provider URL to
   * send the browser to.
   *
   * The state is validated twice, by design. The dashboard pins it to the
   * browser in an httpOnly cookie and compares on callback (CSRF: the
   * response must land in the same browser that started). This service
   * then consumes it from Redis exactly once (replay: a code+state pair
   * that already ran cannot run again).
   */
  async start(provider: AuthProvider): Promise<{ authorizeUrl: string; state: string }> {
    const config = this.requireProvider(provider);

    const state = randomBytes(32).toString('base64url');
    const ttlSeconds = this.configService.get<number>('oauth.stateTtlSeconds')!;
    await this.redisService.client.set(
      `${STATE_KEY_PREFIX}${state}`,
      providerSlug(provider),
      'EX',
      ttlSeconds,
    );

    return { authorizeUrl: this.buildAuthorizeUrl(provider, config, state), state };
  }

  /**
   * Completes the dance: burns the state, exchanges the code with the
   * provider (the only moment the client secret is used), resolves the
   * profile to a Raven user, and issues the same session JWT a password
   * login would — indistinguishable downstream, same logout, same
   * revocation.
   */
  async exchange(provider: AuthProvider, code: string, state: string): Promise<AuthResult> {
    const config = this.requireProvider(provider);
    await this.consumeState(provider, state);

    const profile = await this.fetchProfile(provider, config, code);
    const user = await this.findOrCreateUser(provider, profile);

    return this.authService.issueSessionForUser(user);
  }

  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------

  private async consumeState(provider: AuthProvider, state: string): Promise<void> {
    // GETDEL, not GET-then-DEL: two concurrent redemptions of the same
    // state must race for one value, exactly like UserToken.consume().
    const stored = await this.redisService.client.getdel(`${STATE_KEY_PREFIX}${state}`);
    if (stored !== providerSlug(provider)) {
      // Missing, expired, replayed, or issued for the other provider — one
      // answer for all four, same reasoning as the email-token 400s.
      throw oauthError('This sign-in attempt is invalid or has expired. Please try again.');
    }
  }

  // -----------------------------------------------------------------------
  // Provider HTTP
  // -----------------------------------------------------------------------

  private buildAuthorizeUrl(provider: AuthProvider, config: OAuthProviderConfig, state: string): string {
    if (provider === AuthProvider.GITHUB) {
      const url = new URL(GITHUB_AUTHORIZE_URL);
      url.searchParams.set('client_id', config.clientId!);
      url.searchParams.set('redirect_uri', config.callbackUrl);
      // read:user for the profile, user:email because /user hides an
      // address the person marked private — /user/emails does not.
      url.searchParams.set('scope', 'read:user user:email');
      url.searchParams.set('state', state);
      return url.toString();
    }

    const url = new URL(GOOGLE_AUTHORIZE_URL);
    url.searchParams.set('client_id', config.clientId!);
    url.searchParams.set('redirect_uri', config.callbackUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    return url.toString();
  }

  private async fetchProfile(
    provider: AuthProvider,
    config: OAuthProviderConfig,
    code: string,
  ): Promise<OAuthProfile> {
    try {
      return provider === AuthProvider.GITHUB
        ? await this.fetchGitHubProfile(config, code)
        : await this.fetchGoogleProfile(config, code);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      // Message and stack only. Never the code, never a token: an
      // authorization code in a log line is a live credential.
      this.logger.warn(
        `${providerLabel(provider)} profile fetch failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      throw oauthError(`Could not complete sign-in with ${providerLabel(provider)}. Please try again.`);
    }
  }

  private async fetchGitHubProfile(config: OAuthProviderConfig, code: string): Promise<OAuthProfile> {
    const tokenResponse = await this.providerFetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.callbackUrl,
      }),
    });
    const accessToken: unknown = tokenResponse?.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      // GitHub reports a used/expired code as 200 + {error}, not an HTTP
      // failure, so this is the branch a stale code actually lands in.
      throw oauthError('GitHub did not accept this sign-in. Please try again.');
    }

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      // GitHub rejects requests without one.
      'User-Agent': 'raven-api',
    };

    const user = await this.providerFetch(GITHUB_USER_URL, { headers });
    if (typeof user?.id !== 'number' && typeof user?.id !== 'string') {
      throw oauthError('GitHub returned an unusable profile. Please try again.');
    }

    // /user omits an email the person marked private; /user/emails lists
    // them all with verified flags. Primary-and-verified wins, any
    // verified address is the fallback.
    let email: string | null = null;
    let emailVerified = false;
    const emails = (await this.providerFetch(GITHUB_EMAILS_URL, { headers })) as Array<{
      email: string;
      primary: boolean;
      verified: boolean;
    }> | null;
    if (Array.isArray(emails)) {
      const best = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
      if (best) {
        email = best.email;
        emailVerified = true;
      } else if (emails.length > 0) {
        email = emails.find((e) => e.primary)?.email ?? emails[0].email;
      }
    }

    return {
      providerAccountId: String(user.id),
      email,
      emailVerified,
      name: typeof user.name === 'string' && user.name ? user.name : typeof user.login === 'string' ? user.login : null,
    };
  }

  private async fetchGoogleProfile(config: OAuthProviderConfig, code: string): Promise<OAuthProfile> {
    const tokenResponse = await this.providerFetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId!,
        client_secret: config.clientSecret!,
        code,
        redirect_uri: config.callbackUrl,
        grant_type: 'authorization_code',
      }).toString(),
    });

    const idToken: unknown = tokenResponse?.id_token;
    if (typeof idToken !== 'string' || !idToken) {
      throw oauthError('Google did not accept this sign-in. Please try again.');
    }

    // The id_token arrived seconds ago over TLS directly from Google's
    // token endpoint in exchange for our client secret — that channel is
    // what authenticates it, so decoding without a signature check is
    // sound here. The same token accepted from a *client* would need full
    // JWKS verification.
    const claims = this.decodeJwtPayload(idToken);
    if (typeof claims?.sub !== 'string' || !claims.sub) {
      throw oauthError('Google returned an unusable profile. Please try again.');
    }

    return {
      providerAccountId: claims.sub,
      email: typeof claims.email === 'string' ? claims.email : null,
      emailVerified: claims.email_verified === true,
      name: typeof claims.name === 'string' && claims.name ? claims.name : null,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async providerFetch(url: string, init: RequestInit): Promise<any> {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`provider responded ${response.status}`);
    }
    return response.json();
  }

  private decodeJwtPayload(token: string): Record<string, unknown> | null {
    try {
      const [, payload] = token.split('.');
      return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Identity resolution
  // -----------------------------------------------------------------------

  /**
   * Resolves a provider profile to exactly one Raven user:
   *
   * 1. A link already exists → that user. Returning logins can never mint
   *    a duplicate, whatever their email now says.
   * 2. No link, but a Raven account owns the profile's email → link them,
   *    but only when the provider verified the address (see OAuthProfile).
   * 3. Nobody → a fresh account with no password, plus an onboarding row,
   *    same as register() creates.
   */
  private async findOrCreateUser(provider: AuthProvider, profile: OAuthProfile, attempt = 0): Promise<User> {
    const existingLink = await this.prisma.authAccount.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId: profile.providerAccountId } },
      include: { user: true },
    });

    if (existingLink) {
      if (profile.email && profile.email !== existingLink.email) {
        await this.prisma.authAccount.update({
          where: { id: existingLink.id },
          data: { email: profile.email },
        });
      }
      return existingLink.user;
    }

    if (!profile.email) {
      throw new AppError(
        `${providerLabel(provider)} did not share a usable email address. Add a verified email to your ${providerLabel(provider)} account, or sign up with email and password.`,
        HttpStatus.BAD_REQUEST,
        RavenErrorCode.OAUTH_EMAIL_UNAVAILABLE,
      );
    }

    const existingUser = await this.prisma.user.findUnique({ where: { email: profile.email } });

    if (existingUser) {
      if (!profile.emailVerified) {
        throw new AppError(
          `A Raven account already exists for ${profile.email}, but ${providerLabel(provider)} has not verified that address. Verify it with ${providerLabel(provider)} first, or sign in with your password.`,
          HttpStatus.FORBIDDEN,
          RavenErrorCode.OAUTH_EMAIL_UNVERIFIED,
        );
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.authAccount.create({
          data: { userId: existingUser.id, provider, providerAccountId: profile.providerAccountId, email: profile.email },
        });
        // The provider just proved this address; an account that was
        // waiting on a verification email no longer needs to be.
        await tx.user.updateMany({
          where: { id: existingUser.id, emailVerifiedAt: null },
          data: { emailVerifiedAt: new Date() },
        });
      });
      // Backfills an account that predates metering. Idempotent, so an
      // account that already has an allowance is untouched — in particular
      // its spent minutes are not reset by signing in again.
      await this.usageAllowances.ensureProvisioned(existingUser.id);
      return existingUser;
    }

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: profile.email!,
            name: profile.name,
            // No password: this account signs in through the provider.
            passwordHash: null,
            emailVerifiedAt: profile.emailVerified ? new Date() : null,
          },
        });
        await tx.authAccount.create({
          data: { userId: created.id, provider, providerAccountId: profile.providerAccountId, email: profile.email },
        });
        await tx.userOnboarding.create({ data: { userId: created.id } });
        return created;
      });

      // The free Raven minutes, same as the password-registration path.
      // Outside the transaction because it is idempotent and its own
      // service's concern: an account that exists without an allowance row
      // gets one on the next read anyway, so failing here must not undo a
      // sign-in that already succeeded.
      await this.usageAllowances.ensureProvisioned(user.id);

      // Provider-verified addresses skip the verification email entirely,
      // so the welcome — normally sent on verification — goes out now.
      // Best-effort, same as register(): a missing welcome email must not
      // fail a sign-in that already created the account.
      if (profile.emailVerified) {
        const result = await this.emailService.send({
          to: user.email,
          type: EmailType.Welcome,
          email: renderWelcomeEmail({
            name: user.name,
            brand: this.emailService.brand,
            docsUrl: this.emailService.docsUrl,
          }),
        });
        if (result.status !== 'sent') {
          this.logger.warn(`welcome email not sent status=${result.status}`);
        }
      }

      return user;
    } catch (error) {
      // Two first logins racing: one of them hit the unique email or the
      // unique (provider, providerAccountId). The row it lost to is the
      // account we want, so resolve again instead of failing the person.
      if (this.isUniqueViolation(error) && attempt === 0) {
        return this.findOrCreateUser(provider, profile, attempt + 1);
      }
      throw error;
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }

  // -----------------------------------------------------------------------

  private providerConfig(provider: AuthProvider): OAuthProviderConfig {
    return this.configService.get<OAuthProviderConfig>(`oauth.${providerSlug(provider)}`)!;
  }

  private requireProvider(provider: AuthProvider): OAuthProviderConfig {
    const config = this.providerConfig(provider);
    if (!config.enabled) {
      throw new AppError(
        `${providerLabel(provider)} sign-in is not configured on this deployment`,
        HttpStatus.NOT_IMPLEMENTED,
        RavenErrorCode.NOT_CONFIGURED,
      );
    }
    return config;
  }
}
