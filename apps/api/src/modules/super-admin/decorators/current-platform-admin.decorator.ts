import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { AuthenticatedPlatformAdmin } from '../guards/platform-role.guard';

/** Only ever populated by `PlatformRoleGuard`, which every super-admin route runs behind. */
export const CurrentPlatformAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedPlatformAdmin => {
    const request = ctx.switchToHttp().getRequest();
    return request.platformAdmin as AuthenticatedPlatformAdmin;
  },
);
