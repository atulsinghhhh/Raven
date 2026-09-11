import { PrismaService } from '../database/prisma.service';
import { ProjectOriginService } from './project-origin.service';

function prismaReturning(rows: Record<string, { allowedOrigins: string[]; allowLocalhostOrigins: boolean } | null>): {
  prisma: PrismaService;
  findUnique: jest.Mock;
} {
  const findUnique = jest.fn(async ({ where }: { where: { id: string } }) => rows[where.id] ?? null);
  return { prisma: { project: { findUnique } } as unknown as PrismaService, findUnique };
}

describe('ProjectOriginService', () => {
  it('reads a project policy and applies it', async () => {
    const { prisma } = prismaReturning({
      'project-a': { allowedOrigins: ['https://app-a.com'], allowLocalhostOrigins: true },
    });
    const service = new ProjectOriginService(prisma);

    await expect(service.isAllowed('project-a', 'https://app-a.com')).resolves.toBe(true);
    await expect(service.isAllowed('project-a', 'https://evil.example')).resolves.toBe(false);
  });

  it('keeps tenants apart even when both are consulted', async () => {
    const { prisma } = prismaReturning({
      'project-a': { allowedOrigins: ['https://app-a.com'], allowLocalhostOrigins: false },
      'project-b': { allowedOrigins: ['https://app-b.com'], allowLocalhostOrigins: false },
    });
    const service = new ProjectOriginService(prisma);

    await expect(service.isAllowed('project-a', 'https://app-a.com')).resolves.toBe(true);
    await expect(service.isAllowed('project-a', 'https://app-b.com')).resolves.toBe(false);
    await expect(service.isAllowed('project-b', 'https://app-b.com')).resolves.toBe(true);
    await expect(service.isAllowed('project-b', 'https://app-a.com')).resolves.toBe(false);
  });

  it('caches, so telemetry does not put a query on the hot path', async () => {
    const { prisma, findUnique } = prismaReturning({
      'project-a': { allowedOrigins: ['https://app-a.com'], allowLocalhostOrigins: true },
    });
    const service = new ProjectOriginService(prisma);

    for (let i = 0; i < 5; i++) {
      await service.isAllowed('project-a', 'https://app-a.com');
    }

    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('re-reads after invalidation, so a dashboard edit takes effect at once', async () => {
    const rows: Record<string, { allowedOrigins: string[]; allowLocalhostOrigins: boolean }> = {
      'project-a': { allowedOrigins: [], allowLocalhostOrigins: true },
    };
    const findUnique = jest.fn(async () => rows['project-a']);
    const service = new ProjectOriginService({ project: { findUnique } } as unknown as PrismaService);

    // Unconfigured: open.
    await expect(service.isAllowed('project-a', 'https://app-a.com')).resolves.toBe(true);

    rows['project-a'] = { allowedOrigins: ['https://only-this.com'], allowLocalhostOrigins: true };
    service.invalidate('project-a');

    await expect(service.isAllowed('project-a', 'https://app-a.com')).resolves.toBe(false);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('does not cache a missing project as a policy', async () => {
    // Otherwise a project created moments later would be denied for the
    // whole TTL.
    const { prisma, findUnique } = prismaReturning({});
    const service = new ProjectOriginService(prisma);

    await service.isAllowed('ghost', 'https://app-a.com');
    await service.isAllowed('ghost', 'https://app-a.com');

    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('fails closed for a project that does not exist', async () => {
    // A validly signed token for a project that is gone is an anomaly, and
    // an empty allow-list would read as "unconfigured", which is open.
    const { prisma } = prismaReturning({});
    const service = new ProjectOriginService(prisma);

    await expect(service.isAllowed('ghost', 'https://app-a.com')).resolves.toBe(false);
    // Not even a missing Origin gets through, since the project itself is
    // the thing in doubt.
    await expect(service.isAllowed('ghost', undefined)).resolves.toBe(false);
  });

  it('honours the per-project localhost switch', async () => {
    const { prisma } = prismaReturning({
      lax: { allowedOrigins: ['https://app.com'], allowLocalhostOrigins: true },
      strict: { allowedOrigins: ['https://app.com'], allowLocalhostOrigins: false },
    });
    const service = new ProjectOriginService(prisma);

    await expect(service.isAllowed('lax', 'http://localhost:5173')).resolves.toBe(true);
    await expect(service.isAllowed('strict', 'http://localhost:5173')).resolves.toBe(false);
  });
});
