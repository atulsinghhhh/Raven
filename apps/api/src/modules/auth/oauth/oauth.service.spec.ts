import { ConfigService } from '@nestjs/config';
import { AuthProvider } from '../../../generated/prisma/client';
import { AppError } from '../../../shared/errors/app-error';
import { RavenErrorCode } from '../../../shared/errors/error-codes';
import { PrismaService } from '../../../shared/database/prisma.service';
import { RedisService } from '../../../shared/redis/redis.service';
import { EmailService } from '../../email/email.service';
import { AuthService } from '../auth.service';
import { UsageAllowanceService } from '../../usage/usage-allowance.service';
import { OAuthService } from './oauth.service';

const CONFIG: Record<string, unknown> = {
  'oauth.stateTtlSeconds': 600,
  'oauth.github': {
    enabled: true,
    clientId: 'gh-client-id',
    clientSecret: 'gh-client-secret',
    callbackUrl: 'http://localhost:3000/api/auth/oauth/github/callback',
  },
  'oauth.google': {
    enabled: false,
    callbackUrl: 'http://localhost:3000/api/auth/oauth/google/callback',
  },
};

describe('OAuthService', () => {
  let service: OAuthService;
  let redis: { client: { set: jest.Mock; getdel: jest.Mock } };
  let prisma: {
    authAccount: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    user: { findUnique: jest.Mock; create: jest.Mock; updateMany: jest.Mock };
    userOnboarding: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let authService: { issueSessionForUser: jest.Mock };
  let emailService: { send: jest.Mock; brand: unknown; docsUrl: string };
  let usageAllowances: { ensureProvisioned: jest.Mock };
  let fetchMock: jest.Mock;

  const SESSION = { accessToken: 'jwt', expiresIn: '12h', user: {}, onboarding: { completed: false, step: 1 } };

  beforeEach(() => {
    const configService = { get: jest.fn((key: string) => CONFIG[key]) } as unknown as ConfigService;
    redis = { client: { set: jest.fn(), getdel: jest.fn() } };

    // The tx handed to $transaction is the same mock surface: these tests
    // assert which writes happen, not transactional isolation.
    prisma = {
      authAccount: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      user: { findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
      userOnboarding: { create: jest.fn() },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    };

    authService = { issueSessionForUser: jest.fn().mockResolvedValue(SESSION) };
    emailService = {
      send: jest.fn().mockResolvedValue({ status: 'sent', messageId: 'msg_1' }),
      brand: { appUrl: 'http://localhost:3000', supportEmail: 'support@raven.local' },
      docsUrl: 'http://localhost:3200',
    };

    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    usageAllowances = { ensureProvisioned: jest.fn().mockResolvedValue({ id: 'ua1' }) };

    service = new OAuthService(
      configService,
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      authService as unknown as AuthService,
      emailService as unknown as EmailService,
      usageAllowances as unknown as UsageAllowanceService,
    );
  });

  function jsonResponse(body: unknown) {
    return { ok: true, json: () => Promise.resolve(body) };
  }

  /** Queues the three GitHub calls: token exchange, /user, /user/emails. */
  function mockGitHubHappyPath(overrides: { emails?: unknown; user?: unknown } = {}) {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'gho_token' }))
      .mockResolvedValueOnce(jsonResponse(overrides.user ?? { id: 12345, login: 'octocat', name: 'Octo Cat' }))
      .mockResolvedValueOnce(
        jsonResponse(overrides.emails ?? [{ email: 'octo@example.com', primary: true, verified: true }]),
      );
  }

  describe('enabledProviders', () => {
    it('reports exactly what the config enables', () => {
      expect(service.enabledProviders()).toEqual({ github: true, google: false });
    });
  });

  describe('start', () => {
    it('refuses a provider this deployment has not configured', async () => {
      await expect(service.start(AuthProvider.GOOGLE)).rejects.toMatchObject({
        code: RavenErrorCode.NOT_CONFIGURED,
      });
    });

    it('stores a single-use state in Redis with the configured TTL', async () => {
      const { state } = await service.start(AuthProvider.GITHUB);
      expect(redis.client.set).toHaveBeenCalledWith(`oauth:state:${state}`, 'github', 'EX', 600);
    });

    it('builds an authorize URL carrying client id, callback, scope, and state — never the secret', async () => {
      const { authorizeUrl, state } = await service.start(AuthProvider.GITHUB);
      const url = new URL(authorizeUrl);
      expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
      expect(url.searchParams.get('client_id')).toBe('gh-client-id');
      expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/oauth/github/callback');
      expect(url.searchParams.get('state')).toBe(state);
      expect(authorizeUrl).not.toContain('gh-client-secret');
    });
  });

  describe('exchange', () => {
    it('rejects a state Redis does not know (expired, replayed, or forged)', async () => {
      redis.client.getdel.mockResolvedValue(null);
      await expect(service.exchange(AuthProvider.GITHUB, 'code', 'bad-state')).rejects.toMatchObject({
        code: RavenErrorCode.OAUTH_ERROR,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a state issued for the other provider', async () => {
      redis.client.getdel.mockResolvedValue('google');
      await expect(service.exchange(AuthProvider.GITHUB, 'code', 'state')).rejects.toMatchObject({
        code: RavenErrorCode.OAUTH_ERROR,
      });
    });

    it('signs in a returning provider account without creating anything', async () => {
      redis.client.getdel.mockResolvedValue('github');
      mockGitHubHappyPath();
      const user = { id: 'u1', email: 'octo@example.com' };
      prisma.authAccount.findUnique.mockResolvedValue({ id: 'a1', email: 'octo@example.com', user });

      const result = await service.exchange(AuthProvider.GITHUB, 'code', 'state');

      expect(result).toBe(SESSION);
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.authAccount.create).not.toHaveBeenCalled();
      expect(authService.issueSessionForUser).toHaveBeenCalledWith(user);
    });

    it('links a first-time provider login to the existing account that owns the (verified) email', async () => {
      redis.client.getdel.mockResolvedValue('github');
      mockGitHubHappyPath();
      prisma.authAccount.findUnique.mockResolvedValue(null);
      const existing = { id: 'u2', email: 'octo@example.com', emailVerifiedAt: null };
      prisma.user.findUnique.mockResolvedValue(existing);

      await service.exchange(AuthProvider.GITHUB, 'code', 'state');

      expect(prisma.authAccount.create).toHaveBeenCalledWith({
        data: {
          userId: 'u2',
          provider: AuthProvider.GITHUB,
          providerAccountId: '12345',
          email: 'octo@example.com',
        },
      });
      // The provider proved the address; the pending verification is done.
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'u2', emailVerifiedAt: null },
        data: { emailVerifiedAt: expect.any(Date) },
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('refuses to link when the provider has not verified the email — account-takeover protection', async () => {
      redis.client.getdel.mockResolvedValue('github');
      mockGitHubHappyPath({ emails: [{ email: 'octo@example.com', primary: true, verified: false }] });
      prisma.authAccount.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ id: 'u2', email: 'octo@example.com' });

      await expect(service.exchange(AuthProvider.GITHUB, 'code', 'state')).rejects.toMatchObject({
        code: RavenErrorCode.OAUTH_EMAIL_UNVERIFIED,
      });
      expect(prisma.authAccount.create).not.toHaveBeenCalled();
    });

    it('creates a passwordless user + link + onboarding row for a brand-new person', async () => {
      redis.client.getdel.mockResolvedValue('github');
      mockGitHubHappyPath();
      prisma.authAccount.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      const created = { id: 'u3', email: 'octo@example.com', name: 'Octo Cat' };
      prisma.user.create.mockResolvedValue(created);

      await service.exchange(AuthProvider.GITHUB, 'code', 'state');

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: 'octo@example.com',
          name: 'Octo Cat',
          passwordHash: null,
          emailVerifiedAt: expect.any(Date),
        },
      });
      expect(prisma.userOnboarding.create).toHaveBeenCalledWith({ data: { userId: 'u3' } });
      // Provider-verified address: the welcome email goes out now, since
      // there will never be a verification click to trigger it.
      expect(emailService.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'octo@example.com' }));
      expect(authService.issueSessionForUser).toHaveBeenCalledWith(created);
    });

    it('rejects a profile with no usable email instead of minting an email-less account', async () => {
      redis.client.getdel.mockResolvedValue('github');
      mockGitHubHappyPath({ emails: [] });
      prisma.authAccount.findUnique.mockResolvedValue(null);

      await expect(service.exchange(AuthProvider.GITHUB, 'code', 'state')).rejects.toMatchObject({
        code: RavenErrorCode.OAUTH_EMAIL_UNAVAILABLE,
      });
    });

    it('maps a rejected code to OAUTH_ERROR without leaking provider details', async () => {
      redis.client.getdel.mockResolvedValue('github');
      // GitHub reports a stale code as 200 + an error body, not an HTTP error.
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'bad_verification_code' }));

      const error = await service.exchange(AuthProvider.GITHUB, 'code', 'state').catch((e: AppError) => e);
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(RavenErrorCode.OAUTH_ERROR);
      expect((error as AppError).message).not.toContain('bad_verification_code');
    });

    it('resolves the losing side of a concurrent first-login race to the row that won', async () => {
      redis.client.getdel.mockResolvedValue('github');
      mockGitHubHappyPath();
      const winner = { id: 'u4', email: 'octo@example.com' };
      // First resolution: nothing exists, create collides (P2002). Second:
      // the winner's link is found.
      prisma.authAccount.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'a9', email: 'octo@example.com', user: winner });
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.user.create.mockRejectedValueOnce({ code: 'P2002' });

      const result = await service.exchange(AuthProvider.GITHUB, 'code', 'state');
      expect(result).toBe(SESSION);
      expect(authService.issueSessionForUser).toHaveBeenCalledWith(winner);
    });
  });
});
