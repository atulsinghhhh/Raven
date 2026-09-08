import { UserTokenType } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { UserTokensService, hashUserToken } from './user-tokens.service';

describe('UserTokensService', () => {
  let prisma: {
    userToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let service: UserTokensService;

  beforeEach(() => {
    prisma = {
      userToken: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    service = new UserTokensService(prisma as unknown as PrismaService);
  });

  describe('issue', () => {
    it('stores only a hash — the raw token never reaches the database', async () => {
      const { token } = await service.issue('u1', UserTokenType.EMAIL_VERIFICATION, 60);

      const [{ data }] = prisma.userToken.create.mock.calls[0];
      expect(data.tokenHash).toBe(hashUserToken(token));
      expect(JSON.stringify(data)).not.toContain(token);
    });

    it('returns a token with enough entropy to be unguessable', async () => {
      const { token } = await service.issue('u1', UserTokenType.PASSWORD_RESET, 60);

      // 32 random bytes, base64url — 43 characters, and no characters a
      // URL or a mail client would rewrite.
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('invalidates any outstanding token of the same type first', async () => {
      await service.issue('u1', UserTokenType.PASSWORD_RESET, 60);

      expect(prisma.userToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', type: UserTokenType.PASSWORD_RESET, consumedAt: null },
        data: { consumedAt: expect.any(Date) },
      });
    });

    it('sets an expiry from the configured TTL', async () => {
      const before = Date.now();
      const { expiresAt } = await service.issue('u1', UserTokenType.EMAIL_VERIFICATION, 60);

      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 59 * 60 * 1000);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(before + 61 * 60 * 1000);
    });
  });

  describe('consume', () => {
    const live = {
      id: 't1',
      userId: 'u1',
      type: UserTokenType.PASSWORD_RESET,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    };

    it('returns the owner and marks the token used', async () => {
      prisma.userToken.findUnique.mockResolvedValue(live);

      await expect(service.consume('raw', UserTokenType.PASSWORD_RESET)).resolves.toBe('u1');
      expect(prisma.userToken.updateMany).toHaveBeenCalledWith({
        where: { id: 't1', consumedAt: null },
        data: { consumedAt: expect.any(Date) },
      });
    });

    it('looks the token up by hash, never by the raw value', async () => {
      prisma.userToken.findUnique.mockResolvedValue(live);

      await service.consume('raw', UserTokenType.PASSWORD_RESET);

      expect(prisma.userToken.findUnique.mock.calls[0][0].where).toEqual({
        tokenHash: hashUserToken('raw'),
      });
    });

    it('rejects an expired token', async () => {
      prisma.userToken.findUnique.mockResolvedValue({ ...live, expiresAt: new Date(Date.now() - 1) });

      await expect(service.consume('raw', UserTokenType.PASSWORD_RESET)).resolves.toBeNull();
    });

    it('rejects a token that was already used', async () => {
      prisma.userToken.findUnique.mockResolvedValue({ ...live, consumedAt: new Date() });

      await expect(service.consume('raw', UserTokenType.PASSWORD_RESET)).resolves.toBeNull();
    });

    it('rejects a verification token presented to the reset flow', async () => {
      prisma.userToken.findUnique.mockResolvedValue({
        ...live,
        type: UserTokenType.EMAIL_VERIFICATION,
      });

      await expect(service.consume('raw', UserTokenType.PASSWORD_RESET)).resolves.toBeNull();
    });

    it('rejects an unknown token', async () => {
      prisma.userToken.findUnique.mockResolvedValue(null);

      await expect(service.consume('raw', UserTokenType.PASSWORD_RESET)).resolves.toBeNull();
    });

    it('lets only one of two concurrent redemptions win', async () => {
      prisma.userToken.findUnique.mockResolvedValue(live);
      // The conditional update matched no row: someone else got there first.
      prisma.userToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.consume('raw', UserTokenType.PASSWORD_RESET)).resolves.toBeNull();
    });
  });
});
