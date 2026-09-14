import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentPlatformAdmin } from './decorators/current-platform-admin.decorator';
import { AuthenticatedPlatformAdmin, PlatformRoleGuard } from './guards/platform-role.guard';

@ApiTags('Super Admin')
@ApiBearerAuth('jwt')
@Controller('v1/super-admin/me')
@UseGuards(JwtAuthGuard, PlatformRoleGuard)
export class SuperAdminMeController {
  @Get()
  @ApiOperation({
    summary: 'The signed-in platform admin',
    description:
      'What the dashboard super-admin layout checks before rendering any console page. A 403 here (no platformRole, or a suspended account) is what keeps a normal developer out — the same guard also runs on every other /v1/super-admin/* route, so hiding the frontend link was never the actual boundary.',
  })
  me(@CurrentPlatformAdmin() admin: AuthenticatedPlatformAdmin) {
    return admin;
  }
}
