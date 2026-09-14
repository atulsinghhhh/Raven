import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformRole } from '../../../generated/prisma/enums';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AuditRequestContext, AuditContext } from '../../audit/audit-context.decorator';
import { AdminAction, AdminTargetType } from '../admin-audit.constants';
import { AdminAuditService } from '../admin-audit.service';
import { CurrentPlatformAdmin } from '../decorators/current-platform-admin.decorator';
import { RequirePlatformRole } from '../decorators/require-platform-role.decorator';
import { AuthenticatedPlatformAdmin, PlatformRoleGuard } from '../guards/platform-role.guard';
import { DevelopersService } from './developers.service';
import { QueryDevelopersDto } from './dto/query-developers.dto';
import { SuspendDeveloperDto } from './dto/suspend-developer.dto';

/**
 * §5/§6 of the spec: the developer directory and the developer detail
 * page. No `@RequirePlatformRole` on the two `GET`s — every one of the
 * four roles (including `READ_ONLY`) can read this, matching "most
 * read-only-ish surfaces" from implementation-plan.md §5. The two
 * mutations require `SUPER_ADMIN` or `ADMIN`, per the spec.
 */
@ApiTags('Super Admin — Developers')
@ApiBearerAuth('jwt')
@Controller('v1/super-admin/developers')
@UseGuards(JwtAuthGuard, PlatformRoleGuard)
export class DevelopersController {
  constructor(
    private readonly developers: DevelopersService,
    private readonly adminAudit: AdminAuditService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'The developer directory',
    description: 'Search, filter, sort, and paginate every developer account on the platform.',
  })
  list(@Query() query: QueryDevelopersDto) {
    return this.developers.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One developer, every tab in a single payload',
    description:
      'Header + Overview + Projects + Activity + Usage + Security in one response, each list already capped. Every call is itself recorded as an admin.user_viewed entry, since an admin looking at a developer\'s account is exactly the kind of thing this portal\'s own audit trail should never miss.',
  })
  @ApiForbiddenResponse({ description: 'Your platform role does not permit this' })
  async detail(@Param('id', ParseUUIDPipe) id: string, @CurrentPlatformAdmin() admin: AuthenticatedPlatformAdmin, @AuditRequestContext() context: AuditContext) {
    const result = await this.developers.detail(id);

    await this.adminAudit.record({
      admin: { id: admin.id, email: admin.email },
      action: AdminAction.UserViewed,
      targetType: AdminTargetType.User,
      targetId: id,
      context,
    });

    return result;
  }

  @Post(':id/suspend')
  @RequirePlatformRole(PlatformRole.SUPER_ADMIN, PlatformRole.ADMIN)
  @ApiOperation({
    summary: 'Suspend a developer account',
    description: 'Sets the account to SUSPENDED and blocks future logins (AuthService already 403s a suspended login). Requires a reason.',
  })
  async suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SuspendDeveloperDto,
    @CurrentPlatformAdmin() admin: AuthenticatedPlatformAdmin,
    @AuditRequestContext() context: AuditContext,
  ) {
    const result = await this.developers.suspend(id, body.reason);

    // The mutation has already committed by the time we get here — a
    // failure to audit-log must never look like a failure to suspend the
    // account. Same ordering AuditService's own callers already use.
    await this.adminAudit.record({
      admin: { id: admin.id, email: admin.email },
      action: AdminAction.AccountSuspended,
      targetType: AdminTargetType.User,
      targetId: id,
      reason: body.reason,
      beforeState: { status: 'ACTIVE' },
      afterState: { status: 'SUSPENDED', reason: body.reason },
      context,
    });

    return result;
  }

  @Post(':id/unsuspend')
  @RequirePlatformRole(PlatformRole.SUPER_ADMIN, PlatformRole.ADMIN)
  @ApiOperation({
    summary: 'Unsuspend a developer account',
    description: 'Sets the account back to ACTIVE and clears the suspension reason. Requires a reason.',
  })
  async unsuspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SuspendDeveloperDto,
    @CurrentPlatformAdmin() admin: AuthenticatedPlatformAdmin,
    @AuditRequestContext() context: AuditContext,
  ) {
    const result = await this.developers.unsuspend(id);

    await this.adminAudit.record({
      admin: { id: admin.id, email: admin.email },
      action: AdminAction.AccountUnsuspended,
      targetType: AdminTargetType.User,
      targetId: id,
      reason: body.reason,
      beforeState: { status: 'SUSPENDED' },
      afterState: { status: 'ACTIVE' },
      context,
    });

    return result;
  }
}
