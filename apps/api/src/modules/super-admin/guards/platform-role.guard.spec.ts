import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../shared/database/prisma.service';
import { PlatformRoleGuard } from './platform-role.guard';

/**
 * The whole point of this guard: a normal developer's JWT is perfectly
 * valid, so `JwtAuthGuard` alone would let them through. These tests prove
 * that a request reaching this guard with no platform role, a suspended
 * account, or the wrong role for the route is rejected with a clear
 * 401/403 — never silently redirected, never let through because the
 * frontend "would have" hidden the link.
 */
describe('PlatformRoleGuard', () => {
  let prisma: { user: { findUnique: jest.Mock } };
  let reflector: { getAllAndOverride: jest.Mock };

  function contextWith(user: unknown): ExecutionContext {
    const request: Record<string, unknown> = { user };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;
  }

  function guard(): PlatformRoleGuard {
    return new PlatformRoleGuard(reflector as unknown as Reflector, prisma as unknown as PrismaService);
  }

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn() } };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
  });

  it('401s when no authenticated user reached the guard', async () => {
    await expect(guard().canActivate(contextWith(undefined))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('403s a valid JWT belonging to a user with no platform role — the normal-developer case', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'dev@example.com',
      platformRole: null,
      status: 'ACTIVE',
    });

    await expect(guard().canActivate(contextWith({ id: 'u1', email: 'dev@example.com' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('403s when the user row no longer exists (deleted account, still-valid token)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(guard().canActivate(contextWith({ id: 'ghost' }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('403s a suspended admin even though platformRole is set', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u2',
      email: 'admin@example.com',
      platformRole: 'ADMIN',
      status: 'SUSPENDED',
    });

    await expect(guard().canActivate(contextWith({ id: 'u2', email: 'admin@example.com' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("403s when the route requires a higher role than the caller holds", async () => {
    reflector.getAllAndOverride.mockReturnValue(['SUPER_ADMIN']);
    prisma.user.findUnique.mockResolvedValue({
      id: 'u3',
      email: 'support@example.com',
      platformRole: 'SUPPORT',
      status: 'ACTIVE',
    });

    await expect(guard().canActivate(contextWith({ id: 'u3', email: 'support@example.com' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('admits any platform role when the route declares no @RequirePlatformRole', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u4',
      email: 'readonly@example.com',
      platformRole: 'READ_ONLY',
      status: 'ACTIVE',
    });

    await expect(guard().canActivate(contextWith({ id: 'u4', email: 'readonly@example.com' }))).resolves.toBe(true);
  });

  it('admits a role explicitly listed by @RequirePlatformRole and attaches request.platformAdmin', async () => {
    reflector.getAllAndOverride.mockReturnValue(['SUPER_ADMIN', 'ADMIN']);
    prisma.user.findUnique.mockResolvedValue({
      id: 'u5',
      email: 'admin@example.com',
      platformRole: 'ADMIN',
      status: 'ACTIVE',
    });

    const request: Record<string, unknown> = { user: { id: 'u5', email: 'admin@example.com' } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;

    await expect(guard().canActivate(context)).resolves.toBe(true);
    expect(request.platformAdmin).toEqual({ id: 'u5', email: 'admin@example.com', platformRole: 'ADMIN' });
  });

  it("re-checks the database every call rather than trusting the JWT payload", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u6',
      email: 'admin@example.com',
      platformRole: 'ADMIN',
      status: 'ACTIVE',
    });

    await guard().canActivate(contextWith({ id: 'u6', email: 'admin@example.com' }));

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u6' },
      select: { id: true, email: true, platformRole: true, status: true },
    });
  });
});
