import { ConfigService } from '@nestjs/config';
import { ApiKeyStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../shared/database/prisma.service';
import { UnauthorizedError } from '../../shared/errors/app-error';
import { pepper } from '../../shared/utils/crypto.util';
import { ApiKeysService } from './api-keys.service';

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
      // Hashing the raw secret directly (no pepper) must NOT match — this
      // is what proves the pepper is actually part of the stored hash and
      // not just decorative.
      expect(await bcrypt.compare(rawSecret, persistedData.secretHash)).toBe(false);
      expect(
        await bcrypt.compare(pepper(rawSecret, TEST_PEPPER), persistedData.secretHash),
      ).toBe(true);
    });
  });

  describe('verify', () => {
    it('rejects a malformed key with no separator', async () => {
      await expect(service.verify('not-a-valid-key')).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('rejects an unknown publicId', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(null);

      await expect(service.verify('rvk_unknown.somesecret')).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
    });

    it('rejects a revoked key even with the correct secret', async () => {
      const secretHash = await hashSecret('correctsecret');
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key1',
        status: ApiKeyStatus.REVOKED,
        secretHash,
        project: { id: 'project1' },
      });

      await expect(service.verify('rvk_x.correctsecret')).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
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

    it('resolves to the owning project on a valid, active key', async () => {
      const secretHash = await hashSecret('correctsecret');
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key1',
        status: ApiKeyStatus.ACTIVE,
        secretHash,
        project: { id: 'project1', name: 'Test' },
      });

      const project = await service.verify('rvk_x.correctsecret');
      expect(project).toEqual({ id: 'project1', name: 'Test' });
    });
  });
});
