import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { User, UserTokenType } from '../../generated/prisma/client';
import { ConflictError, UnauthorizedError, ValidationFailedError } from '../../shared/errors/app-error';
import { RedisService } from '../../shared/redis/redis.service';
import { EmailType } from '../email/email.constants';
import { EmailService } from '../email/email.service';
import {
  renderPasswordChangedEmail,
  renderPasswordResetEmail,
  renderVerificationEmail,
  renderWelcomeEmail,
} from '../email/templates';
import { OnboardingService, OnboardingStatus } from '../onboarding/onboarding.service';
import { UsageAllowanceService } from '../usage/usage-allowance.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthenticatedUser, JwtPayload } from './jwt-payload.interface';
import { UserTokensService } from './user-tokens.service';

const PASSWORD_SALT_ROUNDS = 12;
const REVOCATION_KEY_PREFIX = 'auth:revoked-jti:';

export interface AuthResult {
  accessToken: string;
  expiresIn: string;
  user: { id: string; email: string; name: string | null; emailVerified: boolean };
  /** Where this account is in first-run onboarding, so the dashboard can
   *  route a fresh login to /onboarding or /dashboard without a second
   *  round-trip. */
  onboarding: OnboardingStatus;
}

/**
 * Every password-reset request answers with this, whether or not an
 * account exists. The response cannot become an oracle for "is this
 * address registered": see requestPasswordReset().
 */
const PASSWORD_RESET_ACCEPTED = 'If an account exists for that address, a password-reset link is on its way.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly userTokens: UserTokensService,
    private readonly emailService: EmailService,
    private readonly onboardingService: OnboardingService,
    private readonly usageAllowances: UsageAllowanceService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictError('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_SALT_ROUNDS);
    const user = await this.usersService.create({
      email: dto.email,
      passwordHash,
      name: dto.name,
    });

    // Awaited, but we don't let its result gate the response: an
    // account that exists with an unsent verification email is a
    // recoverable state (the dashboard can ask for another), whereas a
    // 500 on a registration that already wrote a user row is not. The
    // welcome email is not sent here: it goes out once the address is
    // proven, which is also the first moment we know it is deliverable.
    // The account starts onboarding at step 1. Written here, not lazily on
    // first dashboard load, so "where is this user in onboarding?" always
    // has a row to answer from.
    await this.onboardingService.ensureStarted(user.id);

    // The free Livqeno minutes every developer gets. Written here, next to
    // the onboarding row and for the same reason: "how many minutes does
    // this account have?" should always have a row to answer from, rather
    // than depending on whatever page happens to read it first.
    await this.usageAllowances.ensureProvisioned(user.id);

    await this.sendVerificationEmail(user);

    return this.issueSessionForUser(user);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.usersService.findByEmail(dto.email);
    // A null passwordHash is an OAuth-only account. Same message as a wrong
    // password on purpose: "this account signs in with GitHub" would
    // confirm the address is registered, which "invalid email or password"
    // exists to hide.
    if (!user || !user.passwordHash) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // An unverified address can still sign in. Blocking login here would
    // mean an undelivered email locks a paying developer out of a working
    // account; `emailVerified` on the result is what lets the dashboard
    // nag instead.
    return this.issueSessionForUser(user);
  }

  /**
   * JWTs are stateless, so there's nothing to delete on logout. We just
   * blocklist this token's jti in Redis until its natural expiry: cheap,
   * bounded, no DB write per request like a real session store would need.
   */
  async logout(user: AuthenticatedUser): Promise<void> {
    const ttlSeconds = Math.max(user.exp - Math.floor(Date.now() / 1000), 1);
    await this.redisService.client.set(`${REVOCATION_KEY_PREFIX}${user.jti}`, '1', 'EX', ttlSeconds);
  }

  async isRevoked(jti: string): Promise<boolean> {
    const value = await this.redisService.client.get(`${REVOCATION_KEY_PREFIX}${jti}`);
    return value !== null;
  }

  // ---------------------------------------------------------------------
  // Email verification
  // ---------------------------------------------------------------------

  /**
   * Redeems a link from a verification email.
   *
   * Unauthenticated on purpose: the person clicking is in their mail
   * client, quite possibly on a different device from the one they
   * registered on, and requiring a session first would strand them at a
   * login screen holding a single-use token.
   */
  async verifyEmail(token: string): Promise<{ email: string; verifiedAt: Date }> {
    const userId = await this.userTokens.consume(token, UserTokenType.EMAIL_VERIFICATION);
    if (!userId) {
      throw new ValidationFailedError(
        'This verification link is invalid, already used, or expired. Sign in and request a new one.',
      );
    }

    const { user, newlyVerified } = await this.usersService.markEmailVerified(userId);

    if (newlyVerified) {
      const result = await this.emailService.send({
        to: user.email,
        type: EmailType.Welcome,
        email: renderWelcomeEmail({
          name: user.name,
          brand: this.emailService.brand,
          docsUrl: this.emailService.docsUrl,
        }),
      });
      this.logEmailOutcome(EmailType.Welcome, result.status);
    }

    return { email: user.email, verifiedAt: user.emailVerifiedAt! };
  }

  /**
   * Sends another verification link. Authenticated, so it takes the
   * address from the session rather than the body: a body-supplied
   * address would turn this into a way to mail arbitrary people from
   * Livqeno's domain.
   */
  async resendVerificationEmail(
    actor: AuthenticatedUser,
  ): Promise<{ status: 'sent' | 'already_verified' | 'suppressed'; message: string }> {
    const user = await this.usersService.findById(actor.id);
    if (!user) {
      throw new UnauthorizedError('Invalid or missing credentials');
    }

    if (user.emailVerifiedAt) {
      return { status: 'already_verified', message: 'This address is already confirmed.' };
    }

    const result = await this.sendVerificationEmail(user);
    if (result === 'skipped_cooldown') {
      return {
        status: 'suppressed',
        message: 'A verification email was sent very recently. Check your inbox, then try again in a minute.',
      };
    }

    return { status: 'sent', message: 'A new verification link is on its way.' };
  }

  // ---------------------------------------------------------------------
  // Password reset
  // ---------------------------------------------------------------------

  /**
   * Always resolves with the same message, and always at roughly the same
   * cost: a request for an unknown address does no token write and no
   * send, but the caller cannot see that. Returning "no such account"
   * here would turn this endpoint into a membership oracle for anyone
   * with a list of addresses.
   */
  async requestPasswordReset(email: string): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(email);

    if (user) {
      const ttlMinutes = this.configService.get<number>('email.passwordResetTtlMinutes')!;
      const { token } = await this.userTokens.issue(user.id, UserTokenType.PASSWORD_RESET, ttlMinutes);

      const result = await this.emailService.send({
        to: user.email,
        type: EmailType.PasswordReset,
        email: renderPasswordResetEmail({
          name: user.name,
          resetUrl: this.emailLink('/reset-password', token),
          expiresInMinutes: ttlMinutes,
          brand: this.emailService.brand,
        }),
      });
      this.logEmailOutcome(EmailType.PasswordReset, result.status);
    }

    return { message: PASSWORD_RESET_ACCEPTED };
  }

  /**
   * Sets a new password and burns the link.
   *
   * Known limitation, stated instead of hidden: sessions issued before
   * the reset keep working until they expire (JWTs are stateless here and
   * `logout` blocklists one `jti` at a time, so there is no list of a
   * user's live tokens to revoke). The password-changed notification is
   * what closes the gap operationally: see docs/email.md#password-reset.
   */
  async resetPassword(token: string, password: string): Promise<{ message: string }> {
    const userId = await this.userTokens.consume(token, UserTokenType.PASSWORD_RESET);
    if (!userId) {
      throw new ValidationFailedError(
        'This password-reset link is invalid, already used, or expired. Request a new one.',
      );
    }

    const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
    const user = await this.usersService.updatePassword(userId, passwordHash);

    // Any other reset link that was still outstanding dies with this one.
    await this.userTokens.revokeAll(userId, UserTokenType.PASSWORD_RESET);

    const result = await this.emailService.send({
      to: user.email,
      type: EmailType.PasswordChanged,
      email: renderPasswordChangedEmail({ name: user.name, brand: this.emailService.brand }),
      // Not cooldown-suppressed: if an attacker changes the password
      // twice, the victim must see both. This is the one email whose job
      // is to be noticed, not to be useful.
      cooldown: false,
    });
    this.logEmailOutcome(EmailType.PasswordChanged, result.status);

    return { message: 'Your password has been changed. Sign in with your new password.' };
  }

  // ---------------------------------------------------------------------

  private async sendVerificationEmail(user: User): Promise<'sent' | 'skipped_cooldown' | 'other'> {
    const ttlMinutes = this.configService.get<number>('email.verificationTtlMinutes')!;
    const { token } = await this.userTokens.issue(user.id, UserTokenType.EMAIL_VERIFICATION, ttlMinutes);

    const result = await this.emailService.send({
      to: user.email,
      type: EmailType.EmailVerification,
      email: renderVerificationEmail({
        name: user.name,
        verifyUrl: this.emailLink('/verify-email', token),
        expiresInMinutes: ttlMinutes,
        brand: this.emailService.brand,
      }),
    });
    this.logEmailOutcome(EmailType.EmailVerification, result.status);

    if (result.status === 'skipped' && result.reason === 'cooldown') {
      return 'skipped_cooldown';
    }
    return result.status === 'sent' ? 'sent' : 'other';
  }

  /**
   * Builds a link into the **dashboard**. APP_URL, never this API's own
   * public URL. Both routes exist in apps/dashboard; changing one means
   * changing the other.
   */
  private emailLink(path: string, token: string): string {
    const url = new URL(path, this.emailService.brand.appUrl);
    url.searchParams.set('token', token);
    return url.toString();
  }

  /** Type and outcome only. The token that email carries is never logged. */
  private logEmailOutcome(type: EmailType, status: string): void {
    if (status === 'sent') {
      return;
    }
    this.logger.warn(`auth email not sent type=${type} status=${status}`);
  }

  /**
   * The one way a session comes into being, whatever proved the identity —
   * password or an OAuth provider. Sessions are indistinguishable
   * downstream: same claims, same jti revocation, same logout.
   */
  async issueSessionForUser(user: {
    id: string;
    email: string;
    name: string | null;
    emailVerifiedAt: Date | null;
  }): Promise<AuthResult> {
    const onboarding = await this.onboardingService.getStatus(user.id);
    return this.issueToken(user, onboarding);
  }

  private issueToken(
    user: {
      id: string;
      email: string;
      name: string | null;
      emailVerifiedAt: Date | null;
    },
    onboarding: OnboardingStatus,
  ): AuthResult {
    const payload: JwtPayload = { sub: user.id, email: user.email, jti: randomUUID() };
    const expiresIn = this.configService.get<string>('jwt.expiresIn')!;
    const accessToken = this.jwtService.sign(payload, { expiresIn });

    return {
      accessToken,
      expiresIn,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        // Boolean() rather than `!== null`: a caller that selected a
        // narrower shape hands us undefined, and an unverified account
        // must never read as verified because a field was absent.
        emailVerified: Boolean(user.emailVerifiedAt),
      },
      onboarding,
    };
  }
}
