import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UserTokenType } from '../../generated/prisma/client';
import { ConflictError, UnauthorizedError, ValidationFailedError } from '../../shared/errors/app-error';
import { RedisService } from '../../shared/redis/redis.service';
import { EmailType } from '../email/email.constants';
import { EmailService } from '../email/email.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { UserTokensService } from './user-tokens.service';

const CONFIG: Record<string, unknown> = {
  'jwt.expiresIn': '12h',
  'email.verificationTtlMinutes': 1440,
  'email.passwordResetTtlMinutes': 60,
};

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let redisService: { client: { set: jest.Mock; get: jest.Mock } };
  let userTokens: { issue: jest.Mock; consume: jest.Mock; revokeAll: jest.Mock };
  let emailService: { send: jest.Mock; brand: unknown; docsUrl: string };
  let onboardingService: { ensureStarted: jest.Mock; getStatus: jest.Mock };

  beforeEach(() => {
    usersService = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      markEmailVerified: jest.fn(),
      updatePassword: jest.fn(),
    } as unknown as jest.Mocked<UsersService>;

    const jwtService = { sign: jest.fn().mockReturnValue('signed.jwt.token') } as unknown as JwtService;
    const configService = { get: jest.fn((key: string) => CONFIG[key]) } as unknown as ConfigService;

    redisService = { client: { set: jest.fn(), get: jest.fn() } };

    userTokens = {
      issue: jest.fn().mockResolvedValue({ token: 'raw-token-value', expiresAt: new Date() }),
      consume: jest.fn(),
      revokeAll: jest.fn().mockResolvedValue(undefined),
    };

    // A fake, never the real client: no test may depend on a Resend API
    // key existing, and CI has none.
    emailService = {
      send: jest.fn().mockResolvedValue({ status: 'sent', messageId: 'msg_1' }),
      brand: { appUrl: 'https://app.ravenstack.online', supportEmail: 'support@mail.ravenstack.online' },
      docsUrl: 'https://docs.ravenstack.online',
    };

    onboardingService = {
      ensureStarted: jest.fn().mockResolvedValue(undefined),
      getStatus: jest.fn().mockResolvedValue({ completed: false, step: 1 }),
    };

    authService = new AuthService(
      usersService,
      jwtService,
      configService,
      redisService as unknown as RedisService,
      userTokens as unknown as UserTokensService,
      emailService as unknown as EmailService,
      onboardingService as unknown as OnboardingService,
    );
  });

  describe('register', () => {
    it('rejects a duplicate email with ConflictError', async () => {
      usersService.findByEmail.mockResolvedValue({ id: 'u1' } as never);

      await expect(authService.register({ email: 'dev@raven.local', password: 'password123' })).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it('hashes the password before persisting — never stores it raw', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockImplementation((data) =>
        Promise.resolve({
          id: 'u1',
          email: data.email,
          passwordHash: data.passwordHash,
          name: data.name ?? null,
        } as never),
      );

      await authService.register({ email: 'dev@raven.local', password: 'password123' });

      const [{ passwordHash }] = usersService.create.mock.calls[0];
      expect(passwordHash).not.toBe('password123');
      expect(await bcrypt.compare('password123', passwordHash)).toBe(true);
    });
  });

  describe('login', () => {
    it('rejects an unknown email with UnauthorizedError (not a 404)', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(authService.login({ email: 'ghost@raven.local', password: 'whatever' })).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
    });

    it('rejects a wrong password with the same UnauthorizedError as unknown email', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 12);
      usersService.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'dev@raven.local',
        passwordHash,
        name: null,
      } as never);

      await expect(authService.login({ email: 'dev@raven.local', password: 'wrong-password' })).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
    });

    it('succeeds and issues a token for a correct password', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 12);
      usersService.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'dev@raven.local',
        passwordHash,
        name: null,
      } as never);

      const result = await authService.login({ email: 'dev@raven.local', password: 'correct-password' });

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.user).toEqual({
        id: 'u1',
        email: 'dev@raven.local',
        name: null,
        emailVerified: false,
      });
    });

    it('carries onboarding status so the dashboard can route without a second call', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 12);
      usersService.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'dev@raven.local',
        passwordHash,
        name: null,
      } as never);
      onboardingService.getStatus.mockResolvedValue({ completed: true, step: 7 });

      const result = await authService.login({ email: 'dev@raven.local', password: 'correct-password' });
      expect(result.onboarding).toEqual({ completed: true, step: 7 });
    });

    it('rejects a password login against an OAuth-only account with the same message as a wrong password', async () => {
      // A null passwordHash is a GitHub/Google-created account. The
      // response must not reveal how the account signs in.
      usersService.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'dev@raven.local',
        passwordHash: null,
        name: null,
      } as never);

      await expect(authService.login({ email: 'dev@raven.local', password: 'anything' })).rejects.toMatchObject({
        message: 'Invalid email or password',
      });
    });
  });

  describe('logout', () => {
    it('blocklists the token jti in Redis with a TTL matching its remaining lifetime', async () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      await authService.logout({ id: 'u1', email: 'dev@raven.local', jti: 'jti-1', exp: nowSeconds + 100 });

      expect(redisService.client.set).toHaveBeenCalledWith('auth:revoked-jti:jti-1', '1', 'EX', expect.any(Number));
      const ttl = redisService.client.set.mock.calls[0][3];
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(100);
    });
  });

  describe('isRevoked', () => {
    it('returns true only when the jti is present in Redis', async () => {
      redisService.client.get.mockResolvedValueOnce('1').mockResolvedValueOnce(null);

      await expect(authService.isRevoked('revoked-jti')).resolves.toBe(true);
      await expect(authService.isRevoked('active-jti')).resolves.toBe(false);
    });
  });

  describe('register — verification email', () => {
    beforeEach(() => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue({
        id: 'u1',
        email: 'dev@raven.local',
        name: 'Ada',
        emailVerifiedAt: null,
      } as never);
    });

    it('issues a verification token and emails a link built from APP_URL', async () => {
      await authService.register({ email: 'dev@raven.local', password: 'password123' });

      expect(userTokens.issue).toHaveBeenCalledWith('u1', UserTokenType.EMAIL_VERIFICATION, 1440);

      const [payload] = emailService.send.mock.calls[0];
      expect(payload.to).toBe('dev@raven.local');
      expect(payload.type).toBe(EmailType.EmailVerification);
      expect(payload.email.text).toContain('https://app.ravenstack.online/verify-email?token=raw-token-value');
    });

    it('does not send a welcome email at signup — that waits for verification', async () => {
      await authService.register({ email: 'dev@raven.local', password: 'password123' });

      const types = emailService.send.mock.calls.map(([payload]) => payload.type);
      expect(types).not.toContain(EmailType.Welcome);
    });

    it('still creates the account when the email cannot be sent', async () => {
      emailService.send.mockResolvedValue({ status: 'failed', reason: 'permanent', error: 'nope' });

      const result = await authService.register({ email: 'dev@raven.local', password: 'password123' });

      expect(result.accessToken).toBe('signed.jwt.token');
    });
  });

  describe('verifyEmail', () => {
    it('marks the address verified and sends the welcome email', async () => {
      userTokens.consume.mockResolvedValue('u1');
      usersService.markEmailVerified.mockResolvedValue({
        user: { id: 'u1', email: 'dev@raven.local', name: 'Ada', emailVerifiedAt: new Date() },
        newlyVerified: true,
      } as never);

      const result = await authService.verifyEmail('raw-token-value');

      expect(result.email).toBe('dev@raven.local');
      expect(userTokens.consume).toHaveBeenCalledWith('raw-token-value', UserTokenType.EMAIL_VERIFICATION);
      expect(emailService.send.mock.calls[0][0].type).toBe(EmailType.Welcome);
    });

    it('does not send a second welcome email when the link is clicked twice', async () => {
      userTokens.consume.mockResolvedValue('u1');
      usersService.markEmailVerified.mockResolvedValue({
        user: { id: 'u1', email: 'dev@raven.local', name: 'Ada', emailVerifiedAt: new Date() },
        newlyVerified: false,
      } as never);

      await authService.verifyEmail('raw-token-value');

      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('rejects an invalid, used or expired token with the same 400', async () => {
      userTokens.consume.mockResolvedValue(null);

      await expect(authService.verifyEmail('nope')).rejects.toBeInstanceOf(ValidationFailedError);
    });
  });

  describe('resendVerificationEmail', () => {
    const actor = { id: 'u1', email: 'dev@raven.local', jti: 'j', exp: 0 };

    it('says so and sends nothing when the address is already verified', async () => {
      usersService.findById.mockResolvedValue({
        id: 'u1',
        email: 'dev@raven.local',
        name: null,
        emailVerifiedAt: new Date(),
      } as never);

      await expect(authService.resendVerificationEmail(actor)).resolves.toMatchObject({
        status: 'already_verified',
      });
      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('reports suppression when the per-recipient cooldown swallowed it', async () => {
      usersService.findById.mockResolvedValue({
        id: 'u1',
        email: 'dev@raven.local',
        name: null,
        emailVerifiedAt: null,
      } as never);
      emailService.send.mockResolvedValue({ status: 'skipped', reason: 'cooldown' });

      await expect(authService.resendVerificationEmail(actor)).resolves.toMatchObject({
        status: 'suppressed',
      });
    });
  });

  describe('requestPasswordReset', () => {
    it('emails a reset link when the account exists', async () => {
      usersService.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'dev@raven.local',
        name: 'Ada',
        emailVerifiedAt: null,
      } as never);

      await authService.requestPasswordReset('dev@raven.local');

      expect(userTokens.issue).toHaveBeenCalledWith('u1', UserTokenType.PASSWORD_RESET, 60);
      const [payload] = emailService.send.mock.calls[0];
      expect(payload.type).toBe(EmailType.PasswordReset);
      expect(payload.email.text).toContain('https://app.ravenstack.online/reset-password?token=raw-token-value');
    });

    it('answers identically for an unknown address, and sends nothing', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      const unknown = await authService.requestPasswordReset('ghost@raven.local');

      usersService.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'dev@raven.local',
        name: null,
        emailVerifiedAt: null,
      } as never);
      const known = await authService.requestPasswordReset('dev@raven.local');

      // The message is the entire response body, so identical messages
      // mean an attacker learns nothing about which addresses exist.
      expect(unknown).toEqual(known);
      expect(emailService.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('resetPassword', () => {
    beforeEach(() => {
      userTokens.consume.mockResolvedValue('u1');
      usersService.updatePassword.mockResolvedValue({
        id: 'u1',
        email: 'dev@raven.local',
        name: 'Ada',
      } as never);
    });

    it('stores a hash of the new password, never the password', async () => {
      await authService.resetPassword('raw-token-value', 'brand-new-password');

      const [, passwordHash] = usersService.updatePassword.mock.calls[0];
      expect(passwordHash).not.toBe('brand-new-password');
      expect(await bcrypt.compare('brand-new-password', passwordHash)).toBe(true);
    });

    it('kills every other outstanding reset link', async () => {
      await authService.resetPassword('raw-token-value', 'brand-new-password');

      expect(userTokens.revokeAll).toHaveBeenCalledWith('u1', UserTokenType.PASSWORD_RESET);
    });

    it('sends the password-changed notification, exempt from the cooldown', async () => {
      await authService.resetPassword('raw-token-value', 'brand-new-password');

      const [payload] = emailService.send.mock.calls[0];
      expect(payload.type).toBe(EmailType.PasswordChanged);
      expect(payload.cooldown).toBe(false);
    });

    it('rejects an invalid or expired token without touching the password', async () => {
      userTokens.consume.mockResolvedValue(null);

      await expect(authService.resetPassword('nope', 'whatever12')).rejects.toBeInstanceOf(ValidationFailedError);
      expect(usersService.updatePassword).not.toHaveBeenCalled();
    });
  });

  describe('token safety', () => {
    it('never writes a verification or reset token to the logs', async () => {
      const lines: string[] = [];
      const { Logger } = jest.requireActual('@nestjs/common');
      const spies = (['log', 'warn', 'error'] as const).map((level) =>
        jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
          lines.push(String(args[0]));
        }),
      );

      usersService.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'dev@raven.local',
        name: null,
        emailVerifiedAt: null,
      } as never);
      emailService.send.mockResolvedValue({ status: 'failed', reason: 'permanent', error: 'nope' });

      await authService.requestPasswordReset('dev@raven.local');

      expect(lines.join('\n')).not.toContain('raw-token-value');
      spies.forEach((spy) => spy.mockRestore());
    });
  });
});
