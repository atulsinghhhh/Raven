import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PlatformRoleGuard } from '../guards/platform-role.guard';

interface RetentionPolicy {
  adminAuditLogs: string;
  securityEvents: string;
  businessActivityEvents: string;
  highVolumeTelemetry: string;
}

interface PlatformRoleDescription {
  role: 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT' | 'READ_ONLY';
  summary: string;
  canDo: string[];
}

interface SettingsResponse {
  retentionPolicy: RetentionPolicy;
  platformRoles: PlatformRoleDescription[];
}

/**
 * Retention policy + role documentation (spec §21). Deliberately a
 * documentation page, not a config editor: every value below is a
 * hardcoded, honest description of what the platform actually does
 * today (see docs/super-admin/implementation-plan.md §3), not something
 * read out of a settings table. Read-only, no `@RequirePlatformRole(...)`.
 */
@ApiTags('Super Admin — Settings')
@ApiBearerAuth('jwt')
@Controller('v1/super-admin/settings')
@UseGuards(JwtAuthGuard, PlatformRoleGuard)
export class SettingsController {
  @Get()
  @ApiOperation({
    summary: 'Data-retention policy and platform-role reference',
    description: 'Static documentation content. Nothing here is editable or derived from live data in this pass.',
  })
  getSettings(): SettingsResponse {
    return {
      retentionPolicy: {
        adminAuditLogs: 'indefinite',
        securityEvents: 'indefinite (revisit once volume is measured)',
        businessActivityEvents: 'no automatic deletion yet',
        highVolumeTelemetry: 'unchanged from existing product behavior',
      },
      platformRoles: [
        {
          role: 'SUPER_ADMIN',
          summary: 'Full platform access, including granting and revoking other platform admins.',
          canDo: [
            'Everything ADMIN can do',
            'Grant or revoke any platform role (Admins section)',
            'The only role that can perform the two actions above',
          ],
        },
        {
          role: 'ADMIN',
          summary: 'Full operational access to every console section except managing who else holds a platform role.',
          canDo: [
            'View every section of the Super Admin Portal',
            'Suspend/unsuspend developer accounts, change limits, revoke API keys',
            'Cannot grant or revoke platform roles',
          ],
        },
        {
          role: 'SUPPORT',
          summary: 'Read-heavy access for day-to-day support work, plus the narrower mutating actions support needs.',
          canDo: [
            'View every section of the Super Admin Portal',
            'Perform the subset of mutating actions its routes explicitly allow',
            'Cannot grant or revoke platform roles',
          ],
        },
        {
          role: 'READ_ONLY',
          summary: 'View-only access across the whole console. No mutating action succeeds under this role.',
          canDo: ['View every section of the Super Admin Portal', 'Cannot perform any mutating action'],
        },
      ],
    };
  }
}
