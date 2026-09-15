import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformRole } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database/prisma.service';
import { AuthenticatedUser } from '../../auth/jwt-payload.interface';
import { PLATFORM_ROLES_KEY } from '../decorators/require-platform-role.decorator';

/** What a Super Admin Portal endpoint sees about who's calling it. Never the full `User` row. */
export interface AuthenticatedPlatformAdmin {
  id: string;
  email: string;
  platformRole: PlatformRole;
}

/**
 * Second gate on every `/v1/super-admin/*` route, always applied after
 * `JwtAuthGuard`. A normal developer's JWT is perfectly valid — this guard
 * is the only thing standing between it and this namespace, which is why
 * it re-checks against the database on every request rather than trusting
 * anything encoded in the token: a platform role granted or revoked by
 * another admin takes effect on this user's very next request, not on
 * their next login.
 *
 * Missing/invalid JWT never reaches here (JwtAuthGuard 401s first). From
 * here on: no `platformRole` at all, or a role not in the route's
 * `@RequirePlatformRole(...)` list, is a 403 — never a redirect, never a
 * silently empty response, so a script hitting this namespace directly
 * gets an unambiguous answer.
 */
@Injectable()
export class PlatformRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PlatformRole[] | undefined>(PLATFORM_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();
    const authUser = request.user as AuthenticatedUser | undefined;

    if (!authUser) {
      throw new UnauthorizedException();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: authUser.id },
      select: { id: true, email: true, platformRole: true, status: true },
    });

    if (!user || !user.platformRole || user.status === 'SUSPENDED') {
      throw new ForbiddenException('Your account does not have Super Admin Portal access');
    }

    const allowedRoles = required ?? Object.values(PlatformRole);
    if (!allowedRoles.includes(user.platformRole)) {
      throw new ForbiddenException('Your platform role does not permit this action');
    }

    const platformAdmin: AuthenticatedPlatformAdmin = {
      id: user.id,
      email: user.email,
      platformRole: user.platformRole,
    };
    request.platformAdmin = platformAdmin;
    return true;
  }
}
