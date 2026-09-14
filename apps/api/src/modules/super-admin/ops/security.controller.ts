import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PlatformRoleGuard } from '../guards/platform-role.guard';
import { SecurityOverviewResponse, SecurityService } from './security.service';

/**
 * Security surface (spec §16). Read-only, no `@RequirePlatformRole(...)` —
 * every platform role can see the security picture; only the Admins
 * section (granting/revoking platform access) is SUPER_ADMIN-gated.
 */
@ApiTags('Super Admin — Security')
@ApiBearerAuth('jwt')
@Controller('v1/super-admin/security')
@UseGuards(JwtAuthGuard, PlatformRoleGuard)
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  @Get()
  @ApiOperation({
    summary: 'Platform security posture: failed logins, suspicious activity, lockouts, and per-developer risk',
    description:
      'Risk levels are computed with fixed, deterministic rules documented on SecurityService — not a model. See that file for the exact thresholds.',
  })
  getOverview(): Promise<SecurityOverviewResponse> {
    return this.security.getOverview();
  }
}
