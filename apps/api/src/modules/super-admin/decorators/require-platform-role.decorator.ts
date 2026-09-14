import { SetMetadata } from '@nestjs/common';
import { PlatformRole } from '../../../generated/prisma/enums';

export const PLATFORM_ROLES_KEY = 'platformRoles';

/**
 * States the minimum platform roles a Super Admin Portal endpoint accepts.
 * Read by `PlatformRoleGuard`, which runs after `JwtAuthGuard` on every
 * `/v1/super-admin/*` route — there is no route in that namespace without
 * both. Order in the list doesn't imply a hierarchy; a route open to
 * `SUPPORT` and `ADMIN` states both explicitly rather than encoding "SUPPORT
 * is weaker than ADMIN" somewhere a reader has to already know.
 */
export const RequirePlatformRole = (...roles: PlatformRole[]) => SetMetadata(PLATFORM_ROLES_KEY, roles);
