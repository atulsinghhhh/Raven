import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformRole } from '../../../generated/prisma/enums';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AuditContext, AuditRequestContext } from '../../audit/audit-context.decorator';
import { CurrentPlatformAdmin } from '../decorators/current-platform-admin.decorator';
import { RequirePlatformRole } from '../decorators/require-platform-role.decorator';
import { AuthenticatedPlatformAdmin, PlatformRoleGuard } from '../guards/platform-role.guard';
import { QueryUsageDevelopersDto } from './dto/query-usage-developers.dto';
import { UpdateAllowanceDto } from './dto/update-allowance.dto';
import {
  DeveloperUsageDetail,
  DeveloperUsagePage,
  OverviewResponse,
  ProductUsageBreakdown,
  SuperAdminUsageService,
} from './usage.service';

/**
 * Platform-wide Usage & Limits (spec §14) — the cross-developer sibling of
 * `DashboardUsageController` (`apps/api/src/modules/usage`), which stays
 * the one place a developer reads *their own* allowance. Every route here
 * reads or edits some other developer's `UsageAllowance`, which is why
 * every one of them sits behind `PlatformRoleGuard` on top of the normal
 * `JwtAuthGuard` — a valid developer JWT is not enough to reach any of
 * this.
 *
 * Read routes (`overview`, `developers`, `developers/:userId`) carry no
 * `@RequirePlatformRole`, so all four platform roles — including
 * `READ_ONLY` — can load them, the same "read access is not a privilege"
 * reasoning `SuperAdminAuditLogsController` and `ActivityController` use.
 * The one mutating route, `PATCH .../allowance`, is the exception: it
 * requires `SUPER_ADMIN` or `ADMIN` and always writes an audit entry.
 */
@ApiTags('Super Admin / Usage')
@ApiBearerAuth('jwt')
@Controller('v1/super-admin/usage')
@UseGuards(JwtAuthGuard, PlatformRoleGuard)
export class SuperAdminUsageController {
  constructor(private readonly usage: SuperAdminUsageService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Platform-wide usage totals',
    description:
      'Total RTC minutes consumed this month across every developer, total chat messages this month, total live-stream host-hours this month, and how many developers are at or above 90%/100% of any one of their allowances. Every figure is a real aggregate query — see SuperAdminUsageService.',
  })
  getOverview(): Promise<OverviewResponse> {
    return this.usage.getOverview();
  }

  @Get('developers')
  @ApiOperation({
    summary: 'Every developer, with their per-product usage against allowance',
    description:
      'Paginated. Each row carries RTC/Chat/Live-Streaming used/included/remaining and the 50/75/90/100% alert band, so an operator can spot unusual spikes without opening every developer individually.',
  })
  listDevelopers(@Query() query: QueryUsageDevelopersDto): Promise<DeveloperUsagePage> {
    return this.usage.listDevelopers({
      search: query.search,
      atRisk: query.atRisk,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get('developers/:userId')
  @ApiOperation({
    summary: "One developer's full usage breakdown",
    description:
      'RTC/Chat/Live-Streaming allowance figures plus a 30-day daily trend (RTC and Live Streaming only — Chat has no per-session rows to bucket, see implementation-plan.md §4).',
  })
  @ApiNotFoundResponse({ description: 'No developer with that id' })
  getDeveloper(@Param('userId', ParseUUIDPipe) userId: string): Promise<DeveloperUsageDetail> {
    return this.usage.getDeveloper(userId);
  }

  @Patch('developers/:userId/allowance')
  @RequirePlatformRole(PlatformRole.SUPER_ADMIN, PlatformRole.ADMIN)
  @ApiOperation({
    summary: "Change one product's included-minutes/-count grant for a developer",
    description:
      'The one mutating route in this slice. Requires a `reason` (400 without one) and always records an AdminAuditLog entry (action admin.limit_changed, target usage_allowance) with the before/after grant — an admin cannot change a limit silently. Requires the developer to already have an allowance row for this product (i.e. they have used it at least once); this route edits an existing grant, it does not provision a new one.',
  })
  @ApiNotFoundResponse({
    description: 'No developer with that id, or they have no allowance for the given product yet',
  })
  updateAllowance(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: UpdateAllowanceDto,
    @CurrentPlatformAdmin() admin: AuthenticatedPlatformAdmin,
    @AuditRequestContext() context: AuditContext,
  ): Promise<ProductUsageBreakdown> {
    return this.usage.updateAllowance(
      userId,
      {
        product: body.product,
        includedMinutes: body.includedMinutes,
        includedCount: body.includedCount,
        reason: body.reason,
      },
      admin,
      context,
    );
  }
}
