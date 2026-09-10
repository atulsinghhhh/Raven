import { ConfigService } from '@nestjs/config';
import { ApiKeyStatus } from '../../generated/prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../shared/database/prisma.service';
import { UnauthorizedError } from '../../shared/errors/app-error';
import { pepper } from '../../shared/utils/crypto.util';
import { ApiKeysService } from './api-keys.service';
import { Environment } from '../../shared/environment/environment.constants';

/**
 * bcryptjs, wrapped so comparisons can be counted.
 *
 * A passthrough rather than a stub: the real implementation still runs, so
 * every assertion in this file about what actually authenticates stays
 * honest. Only the call count is added. `jest.spyOn` cannot do this —
 * the module's exports are non-configurable.
 */
jest.mock('bcryptjs', () => {
  const real = jest.requireActual<typeof import('bcryptjs')>('bcryptjs');
  return { ...real, compare: jest.fn(real.compare) };
});

const compareCalls = () => (bcrypt.compare as unknown as jest.Mock).mock.calls.length;

const TEST_PEPPER = 'test-pepper-value';

function hashSecret(secret: string): Promise<string> {
  return bcrypt.hash(pepper(secret, TEST_PEPPER), 10);
}

describe('ApiKeysService', () => {
  let service: ApiKeysService;
  let prisma: {
    apiKey: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      apiKey: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const configService = {
      get: jest.fn(() => TEST_PEPPER),
    } as unknown as ConfigService;
    service = new ApiKeysService(prisma as unknown as PrismaService, configService);
  });

  describe('create', () => {
    it('never stores the raw secret in plaintext, even indirectly via a pepper-less hash', async () => {
      prisma.apiKey.create.mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'key1',
          name: data.name ?? null,
          publicId: data.publicId,
          createdAt: new Date(),
        }),
      );

      const result = await service.create('project1', { name: 'test key' });

      const persistedData = prisma.apiKey.create.mock.calls[0][0].data;
      expect(persistedData.secretHash).toBeDefined();
      expect(result.key.startsWith(`${persistedData.publicId}.`)).toBe(true);
      const rawSecret = result.key.split('.')[1];

      expect(persistedData.secretHash).not.toBe(rawSecret);
      // Hashing the raw secret with no pepper must NOT match: proves the
      // pepper actually factors into the stored hash, isn't just decorative.
      expect(await bcrypt.compare(rawSecret, persistedData.secretHash)).toBe(false);
      expect(await bcrypt.compare(pepper(rawSecret, TEST_PEPPER), persistedData.secretHash)).toBe(true);
    });
  });

  describe('verify', () => {
    it('rejects a malformed key with no separator', async () => {
      await expect(service.verify('not-a-valid-key')).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('rejects an unknown publicId', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(null);

      await expect(service.verify('rvk_unknown.somesecret')).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('rejects a revoked key even with the correct secret', async () => {
      const secretHash = await hashSecret('correctsecret');
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key1',
        status: ApiKeyStatus.REVOKED,
        secretHash,
        project: { id: 'project1' },
      });

      await expect(service.verify('rvk_x.correctsecret')).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('rejects the correct publicId with a wrong secret', async () => {
      const secretHash = await hashSecret('correctsecret');
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key1',
        status: ApiKeyStatus.ACTIVE,
        secretHash,
        project: { id: 'project1' },
      });

      await expect(service.verify('rvk_x.wrongsecret')).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('resolves to the owning project, its environment, and the key’s own public id', async () => {
      const secretHash = await hashSecret('correctsecret');
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key1',
        publicId: 'rvk_prod_abc',
        status: ApiKeyStatus.ACTIVE,
        environment: Environment.PRODUCTION,
        secretHash,
        project: { id: 'project1', name: 'Test' },
      });

      const verified = await service.verify('rvk_prod_abc.correctsecret');
      expect(verified).toEqual({
        project: { id: 'project1', name: 'Test' },
        environment: Environment.PRODUCTION,
        publicId: 'rvk_prod_abc',
      });
    });

    it('reports the key’s own id, not the project id, as the rate-limit subject', async () => {
      // Two keys on one project must not share a budget: that isolation
      // depends on this field surviving all the way to RateLimitGuard.
      const secretHash = await hashSecret('correctsecret');
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key1',
        publicId: 'rvk_prod_key_one',
        status: ApiKeyStatus.ACTIVE,
        environment: Environment.PRODUCTION,
        secretHash,
        project: { id: 'project1', name: 'Test' },
      });

      const verified = await service.verify('rvk_prod_key_one.correctsecret');
      expect(verified.publicId).toBe('rvk_prod_key_one');
      expect(verified.publicId).not.toBe(verified.project.id);
    });

    it('takes the environment from the key row, never from the caller', async () => {
      // The whole isolation guarantee rests on this: a request cannot ask
      // to act in production, it can only present a production key.
      const secretHash = await hashSecret('correctsecret');
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key1',
        status: ApiKeyStatus.ACTIVE,
        environment: Environment.DEVELOPMENT,
        secretHash,
        project: { id: 'project1', name: 'Test' },
      });

      const verified = await service.verify('rvk_prod_x.correctsecret');

      // The public id says "prod"; the row says development, and the row wins.
      expect(verified.environment).toBe(Environment.DEVELOPMENT);
    });
  });
  /**
   * The verified-secret cache (see `verifiedSecrets`).
   *
   * `bcryptjs` blocks Node's one thread for ~75ms per comparison, which
   * caps the whole authenticated REST surface at roughly thirteen requests
   * per second per process — the bottleneck a hundred simultaneous viewer
   * mints hit before they reach Postgres at all. The cache removes it.
   *
   * The risk it introduces is obvious and is what most of these cover: a
   * cache in front of authentication must not become a way to keep using a
   * key that has been revoked or rotated.
   */
  describe('verified-secret cache', () => {
    const ACTIVE_ROW = {
      id: 'key1',
      publicId: 'rvk_dev_cached',
      status: ApiKeyStatus.ACTIVE,
      environment: Environment.DEVELOPMENT,
      project: { id: 'project1', name: 'Test' },
    };

    /** A service whose cache config is actually numeric. */
    function serviceWithCache(ttlSeconds = 60, maxEntries = 5000): ApiKeysService {
      const configService = {
        get: jest.fn((key: string) => {
          if (key === 'apiKeyCache.ttlSeconds') return ttlSeconds;
          if (key === 'apiKeyCache.maxEntries') return maxEntries;
          return TEST_PEPPER;
        }),
      } as unknown as ConfigService;
      return new ApiKeysService(prisma as unknown as PrismaService, configService);
    }

    it('skips the second bcrypt comparison for the same key', async () => {
      const secretHash = await hashSecret('correctsecret');
      prisma.apiKey.findUnique.mockResolvedValue({ ...ACTIVE_ROW, secretHash });
      const cached = serviceWithCache();
      const before = compareCalls();

      await cached.verify('rvk_dev_cached.correctsecret');
      await cached.verify('rvk_dev_cached.correctsecret');
      await cached.verify('rvk_dev_cached.correctsecret');

      // One comparison for three requests. This is the entire point.
      expect(compareCalls() - before).toBe(1);
    });

    it('still reads the key row on every single request', async () => {
      const secretHash = await hashSecret('correctsecret');
      prisma.apiKey.findUnique.mockResolvedValue({ ...ACTIVE_ROW, secretHash });
      const cached = serviceWithCache();

      await cached.verify('rvk_dev_cached.correctsecret');
      await cached.verify('rvk_dev_cached.correctsecret');

      // What is cached is the arithmetic, never the authorization
      // decision. The row — and so `status` — is re-read every time.
      expect(prisma.apiKey.findUnique).toHaveBeenCalledTimes(2);
    });

    it('refuses a revoked key immediately, however recently it was verified', async () => {
      const secretHash = await hashSecret('correctsecret');
      prisma.apiKey.findUnique.mockResolvedValue({ ...ACTIVE_ROW, secretHash });
      const cached = serviceWithCache();

      await expect(cached.verify('rvk_dev_cached.correctsecret')).resolves.toMatchObject({
        publicId: 'rvk_dev_cached',
      });

      // The key is revoked. No cache flush, no TTL expiry — just the row
      // changing underneath a warm cache entry.
      prisma.apiKey.findUnique.mockResolvedValue({
        ...ACTIVE_ROW,
        secretHash,
        status: ApiKeyStatus.REVOKED,
      });

      await expect(cached.verify('rvk_dev_cached.correctsecret')).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('re-runs the comparison after the key is rotated', async () => {
      const oldHash = await hashSecret('oldsecret');
      prisma.apiKey.findUnique.mockResolvedValue({ ...ACTIVE_ROW, secretHash: oldHash });
      const cached = serviceWithCache();

      await cached.verify('rvk_dev_cached.oldsecret');

      // Rotation replaces `secretHash`, and an entry is bound to the hash
      // it was verified against — so it can never match the new one.
      const newHash = await hashSecret('newsecret');
      prisma.apiKey.findUnique.mockResolvedValue({ ...ACTIVE_ROW, secretHash: newHash });

      await expect(cached.verify('rvk_dev_cached.oldsecret')).rejects.toBeInstanceOf(UnauthorizedError);
      await expect(cached.verify('rvk_dev_cached.newsecret')).resolves.toMatchObject({
        publicId: 'rvk_dev_cached',
      });
    });

    it('never lets a wrong secret ride on a right one\u2019s cache entry', async () => {
      const secretHash = await hashSecret('correctsecret');
      prisma.apiKey.findUnique.mockResolvedValue({ ...ACTIVE_ROW, secretHash });
      const cached = serviceWithCache();

      await cached.verify('rvk_dev_cached.correctsecret');

      // The cache key includes a digest of the presented secret, so a
      // different secret for the same public id misses and is compared for
      // real. Without that, one valid request would authenticate every
      // subsequent guess against that key.
      await expect(cached.verify('rvk_dev_cached.wrongsecret')).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('expires an entry once its TTL is up', async () => {
      const secretHash = await hashSecret('correctsecret');
      prisma.apiKey.findUnique.mockResolvedValue({ ...ACTIVE_ROW, secretHash });
      const cached = serviceWithCache(1);
      const before = compareCalls();
      const realNow = Date.now;

      try {
        await cached.verify('rvk_dev_cached.correctsecret');
        expect(compareCalls() - before).toBe(1);

        Date.now = () => realNow() + 2_000;
        await cached.verify('rvk_dev_cached.correctsecret');

        expect(compareCalls() - before).toBe(2);
      } finally {
        Date.now = realNow;
      }
    });

    it('stays bounded when sprayed with distinct keys', async () => {
      const secretHash = await hashSecret('correctsecret');
      const cached = serviceWithCache(60, 3);

      for (let index = 0; index < 10; index++) {
        prisma.apiKey.findUnique.mockResolvedValue({
          ...ACTIVE_ROW,
          publicId: `rvk_dev_${index}`,
          secretHash,
        });
        await cached.verify(`rvk_dev_${index}.correctsecret`);
      }

      // Still authenticating correctly after ten distinct keys through a
      // three-entry cache — nothing wedged, nothing unbounded.
      await expect(cached.verify('rvk_dev_9.correctsecret')).resolves.toMatchObject({ publicId: 'rvk_dev_9' });
    });

    it('falls back to a sane TTL when the config value is not a number', async () => {
      const secretHash = await hashSecret('correctsecret');
      prisma.apiKey.findUnique.mockResolvedValue({ ...ACTIVE_ROW, secretHash });
      // The failure this guards against is invisible: NaN milliseconds
      // makes every expiry comparison false and the entry immortal.
      const misconfigured = new ApiKeysService(
        prisma as unknown as PrismaService,
        {
          get: jest.fn(() => TEST_PEPPER),
        } as unknown as ConfigService,
      );
      const before = compareCalls();
      const realNow = Date.now;

      try {
        await misconfigured.verify('rvk_dev_cached.correctsecret');
        Date.now = () => realNow() + 61_000;
        await misconfigured.verify('rvk_dev_cached.correctsecret');

        // Expired on the 60s default rather than living forever.
        expect(compareCalls() - before).toBe(2);
      } finally {
        Date.now = realNow;
      }
    });

    it('drops cached entries for a key it revokes', async () => {
      const secretHash = await hashSecret('correctsecret');
      prisma.apiKey.findUnique.mockResolvedValue({
        ...ACTIVE_ROW,
        projectId: 'project1',
        secretHash,
      });
      prisma.apiKey.update.mockResolvedValue({ ...ACTIVE_ROW, status: ApiKeyStatus.REVOKED });
      const cached = serviceWithCache();
      const before = compareCalls();

      await cached.verify('rvk_dev_cached.correctsecret');
      await cached.revoke('project1', 'key1');

      // Housekeeping rather than the boundary — the row check above is
      // what actually refuses the key — but the entry should be gone.
      prisma.apiKey.findUnique.mockResolvedValue({ ...ACTIVE_ROW, secretHash });
      await cached.verify('rvk_dev_cached.correctsecret');

      expect(compareCalls() - before).toBe(2);
    });
  });
});
