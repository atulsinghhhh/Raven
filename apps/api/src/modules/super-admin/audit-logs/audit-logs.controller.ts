import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformRole } from '../../../generated/prisma/enums';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminAuditPage, AdminAuditQuery, AdminAuditService } from '../admin-audit.service';
import { RequirePlatformRole } from '../decorators/require-platform-role.decorator';
import { PlatformRoleGuard } from '../guards/platform-role.guard';
import { QueryAdminAuditLogsDto } from './dto/query-admin-audit-logs.dto';

/**
 * §9 — the immutable log of what Raven *administrators* did, distinct from
 * the Activity Explorer's developer/business event stream.
 *
 * Read access: all four platform roles, `READ_ONLY` included. This log is
 * transparency infrastructure, not a privileged secret — an admin action
 * taken against a developer's account should be visible to every person
 * who holds any Super Admin Portal access, including the roles that can't
 * take actions themselves. Narrowing this to ADMIN/SUPER_ADMIN would imply
 * SUPPORT and READ_ONLY holders should trust admin actions without being
 * able to see them, which cuts against the whole point of an audit trail.
 * (There is still no path to mutate anything here for any role — see
 * `AdminAuditService`, which exposes no update/delete method at all.)
 */
@ApiTags('Super Admin / Audit Logs')
@ApiBearerAuth('jwt')
@Controller('v1/super-admin/audit-logs')
@UseGuards(JwtAuthGuard, PlatformRoleGuard)
export class SuperAdminAuditLogsController {
  constructor(private readonly adminAudit: AdminAuditService) {}

  @Get()
  @RequirePlatformRole(PlatformRole.SUPER_ADMIN, PlatformRole.ADMIN, PlatformRole.SUPPORT, PlatformRole.READ_ONLY)
  @ApiOperation({
    summary: 'Administrative actions taken on the platform, newest first',
    description:
      'Read-only by construction: there is no endpoint that can change or remove an entry, because an audit log an administrator can edit is not an audit log. Filterable by admin, action, target type/id, and a created-at date range.',
  })
  async list(@Query() query: QueryAdminAuditLogsDto): Promise<AdminAuditPage> {
    const params: AdminAuditQuery = {
      adminId: query.adminId,
      action: query.action,
      targetType: query.targetType,
      targetId: query.targetId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      limit: query.limit,
      offset: query.offset,
    };
    return this.adminAudit.list(params);
  }
}
